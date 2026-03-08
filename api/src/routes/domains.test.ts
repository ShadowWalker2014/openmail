/**
 * Comprehensive unit tests for the sending domain management routes.
 *
 * Covers:
 *   POST   /connect  — register domain with Resend, store DNS records
 *   POST   /verify   — trigger async verification
 *   POST   /refresh  — poll current status from Resend
 *   DELETE /         — disconnect domain (idempotent)
 *
 * Auth, input validation, Resend API errors, DB state assertions all tested.
 */

import { mock, describe, it, expect, beforeEach, beforeAll } from "bun:test";

// ── Mutable shared state ──────────────────────────────────────────────────────
// Factory closures reference this object so test helpers can control
// mock behaviour per-test without re-registering factories.
const state = {
  dbSelectQueue: [] as any[][],
  dbUpdateCaptures: [] as any[],
  resend: {
    create: async (..._: any[]) => ({ data: null, error: null }) as any,
    verify: async (..._: any[]) => ({ data: null, error: null }) as any,
    get: async (..._: any[]) => ({ data: null, error: null }) as any,
    remove: async (..._: any[]) => ({ data: null, error: null }) as any,
  },
};

// ── Module mocks (must be called before dynamic import of module under test) ──

mock.module("resend", () => ({
  Resend: class MockResend {
    // Use a getter so state.resend.* is re-evaluated on every call, not captured
    get domains() {
      return {
        create: (...args: any[]) => state.resend.create(...args),
        verify: (...args: any[]) => state.resend.verify(...args),
        get: (...args: any[]) => state.resend.get(...args),
        remove: (...args: any[]) => state.resend.remove(...args),
      };
    }
  },
}));

mock.module("@openmail/shared/db", () => ({
  getDb: () => ({
    select: () => {
      // Each select() call consumes the next result from the queue.
      // assertOwnerOrAdmin() is the first select; getWorkspaceFull() is second.
      const result = state.dbSelectQueue.shift() ?? [];
      const chain: any = {
        from: () => chain,
        where: () => chain,
        innerJoin: () => chain,
        limit: () => Promise.resolve(result),
      };
      return chain;
    },
    update: () => ({
      set: (values: any) => ({
        where: () => {
          state.dbUpdateCaptures.push(values);
          return Promise.resolve([]);
        },
      }),
    }),
  }),
}));

// Silence logger output during tests
mock.module("../lib/logger.js", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

// ── Lazy imports (resolved after mocks are registered) ────────────────────────
let domainsRouter: any;
let HonoApp: any;

beforeAll(async () => {
  const [domainsModule, honoModule] = await Promise.all([
    import("./domains.js"),
    import("hono"),
  ]);
  domainsRouter = domainsModule.default;
  HonoApp = honoModule.Hono;
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER = { role: "owner" };
const ADMIN = { role: "admin" };
const MEMBER = { role: "member" };

const WS_KEY_NO_DOMAIN = {
  resendApiKey: "re_test_key_123",
  resendDomainId: null,
  resendDomainName: null,
  resendDomainStatus: null,
};

const WS_KEY_WITH_DOMAIN = {
  resendApiKey: "re_test_key_123",
  resendDomainId: "dom_abc123def456",
  resendDomainName: "mail.example.com",
  resendDomainStatus: "not_started",
};

const WS_NO_KEY = {
  resendApiKey: null,
  resendDomainId: null,
  resendDomainName: null,
  resendDomainStatus: null,
};

const WS_DOMAIN_NO_KEY = {
  resendApiKey: null,
  resendDomainId: "dom_abc123def456",
  resendDomainName: "mail.example.com",
  resendDomainStatus: "not_started",
};

const RESEND_DNS_RECORDS = [
  {
    record: "SPF",
    name: "send",
    type: "MX",
    ttl: "Auto",
    status: "not_started",
    value: "feedback-smtp.us-east-1.amazonses.com",
    priority: 10,
  },
  {
    record: "SPF",
    name: "send",
    type: "TXT",
    ttl: "Auto",
    status: "not_started",
    value: '"v=spf1 include:amazonses.com ~all"',
  },
  {
    record: "DKIM",
    name: "nhapbbryle57._domainkey",
    type: "CNAME",
    ttl: "Auto",
    status: "not_started",
    value: "nhapbbryle57.dkim.amazonses.com.",
  },
];

const RESEND_DOMAIN_CREATED = {
  id: "dom_abc123def456",
  name: "mail.example.com",
  status: "not_started",
  records: RESEND_DNS_RECORDS,
  region: "us-east-1",
};

const RESEND_DOMAIN_VERIFIED = {
  id: "dom_abc123def456",
  name: "mail.example.com",
  status: "verified",
  records: RESEND_DNS_RECORDS.map((r) => ({ ...r, status: "verified" })),
  region: "us-east-1",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp(workspaceId = "ws_test_1", userId = "usr_test_1") {
  const app = new HonoApp();
  app.use("*", async (c: any, next: any) => {
    c.set("workspaceId", workspaceId);
    c.set("userId", userId);
    await next();
  });
  app.route("/", domainsRouter);
  return app;
}

function post(app: any, path: string, body?: object) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function del(app: any, path: string) {
  return app.request(path, { method: "DELETE" });
}

function resetState() {
  state.dbSelectQueue = [];
  state.dbUpdateCaptures = [];
  state.resend.create = async () => ({ data: null, error: null });
  state.resend.verify = async () => ({ data: null, error: null });
  state.resend.get = async () => ({ data: null, error: null });
  state.resend.remove = async () => ({ data: null, error: null });
}

// ── POST /connect ─────────────────────────────────────────────────────────────

describe("POST /connect", () => {
  beforeEach(resetState);

  it("201: owner connects domain, returns id + name + status + records", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_NO_DOMAIN]];
    state.resend.create = async () => ({ data: RESEND_DOMAIN_CREATED, error: null });

    const app = makeApp();
    const res = await post(app, "/connect", { domainName: "mail.example.com" });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("dom_abc123def456");
    expect(body.name).toBe("mail.example.com");
    expect(body.status).toBe("not_started");
    expect(Array.isArray(body.records)).toBe(true);
    expect(body.records.length).toBe(3);
    expect(body.records[0].type).toBe("MX");
    expect(body.records[1].type).toBe("TXT");
    expect(body.records[2].type).toBe("CNAME");
  });

  it("201: DB updated with domain id, name, status and records array", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_NO_DOMAIN]];
    state.resend.create = async () => ({ data: RESEND_DOMAIN_CREATED, error: null });

    await post(makeApp(), "/connect", { domainName: "mail.example.com" });

    expect(state.dbUpdateCaptures).toHaveLength(1);
    const captured = state.dbUpdateCaptures[0];
    expect(captured.resendDomainId).toBe("dom_abc123def456");
    expect(captured.resendDomainName).toBe("mail.example.com");
    expect(captured.resendDomainStatus).toBe("not_started");
    expect(Array.isArray(captured.resendDomainRecords)).toBe(true);
    expect(captured.resendDomainRecords.length).toBe(3);
    expect(captured.updatedAt).toBeInstanceOf(Date);
  });

  it("201: admin (non-owner) can also connect domain", async () => {
    state.dbSelectQueue = [[ADMIN], [WS_KEY_NO_DOMAIN]];
    state.resend.create = async () => ({ data: RESEND_DOMAIN_CREATED, error: null });

    const res = await post(makeApp(), "/connect", { domainName: "send.example.com" });
    expect(res.status).toBe(201);
  });

  it("403: plain member cannot connect domain", async () => {
    state.dbSelectQueue = [[MEMBER]];

    const res = await post(makeApp(), "/connect", { domainName: "mail.example.com" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Forbidden");
  });

  it("403: user with no workspace membership is forbidden", async () => {
    state.dbSelectQueue = [[]]; // empty — no membership row

    const res = await post(makeApp(), "/connect", { domainName: "mail.example.com" });
    expect(res.status).toBe(403);
  });

  it("400: no Resend API key configured shows helpful message", async () => {
    state.dbSelectQueue = [[OWNER], [WS_NO_KEY]];

    const res = await post(makeApp(), "/connect", { domainName: "mail.example.com" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Resend API key");
  });

  it("409: cannot connect when domain already linked", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];

    const res = await post(makeApp(), "/connect", { domainName: "other.example.com" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already connected");
  });

  it("400: Resend API returns error (e.g. domain in another account)", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_NO_DOMAIN]];
    state.resend.create = async () => ({
      data: null,
      error: { message: "Domain already exists in another Resend account." },
    });

    const res = await post(makeApp(), "/connect", { domainName: "mail.example.com" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("another Resend account");
  });

  it("400: Resend returns null data without error object", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_NO_DOMAIN]];
    state.resend.create = async () => ({ data: null, error: null });

    const res = await post(makeApp(), "/connect", { domainName: "mail.example.com" });
    expect(res.status).toBe(400);
  });

  it("400: Zod rejects missing domainName field", async () => {
    const res = await post(makeApp(), "/connect", {});
    expect(res.status).toBe(400);
  });

  it("400: Zod rejects empty domain string", async () => {
    const res = await post(makeApp(), "/connect", { domainName: "" });
    expect(res.status).toBe(400);
  });

  it("400: Zod rejects bare hostname without TLD", async () => {
    const res = await post(makeApp(), "/connect", { domainName: "justhostname" });
    expect(res.status).toBe(400);
  });

  it("400: Zod rejects domain with leading hyphen", async () => {
    const res = await post(makeApp(), "/connect", { domainName: "-bad.example.com" });
    expect(res.status).toBe(400);
  });

  it("400: Zod rejects domain with leading dot", async () => {
    const res = await post(makeApp(), "/connect", { domainName: ".example.com" });
    expect(res.status).toBe(400);
  });

  it("400: Zod rejects domain with double dots", async () => {
    const res = await post(makeApp(), "/connect", { domainName: "mail..example.com" });
    expect(res.status).toBe(400);
  });
});

// ── POST /verify ──────────────────────────────────────────────────────────────

describe("POST /verify", () => {
  beforeEach(resetState);

  it("200: triggers verification and updates DB status to pending", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.verify = async () => ({ data: { object: "domain", id: "dom_abc123def456" }, error: null });

    const res = await post(makeApp(), "/verify");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pending");

    expect(state.dbUpdateCaptures).toHaveLength(1);
    expect(state.dbUpdateCaptures[0].resendDomainStatus).toBe("pending");
    expect(state.dbUpdateCaptures[0].updatedAt).toBeInstanceOf(Date);
  });

  it("200: admin can trigger verification", async () => {
    state.dbSelectQueue = [[ADMIN], [WS_KEY_WITH_DOMAIN]];
    state.resend.verify = async () => ({ data: { object: "domain", id: "dom_abc123def456" }, error: null });

    const res = await post(makeApp(), "/verify");
    expect(res.status).toBe(200);
  });

  it("403: member cannot trigger verification", async () => {
    state.dbSelectQueue = [[MEMBER]];
    const res = await post(makeApp(), "/verify");
    expect(res.status).toBe(403);
  });

  it("403: no membership is forbidden", async () => {
    state.dbSelectQueue = [[]];
    const res = await post(makeApp(), "/verify");
    expect(res.status).toBe(403);
  });

  it("400: no domain connected", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_NO_DOMAIN]];

    const res = await post(makeApp(), "/verify");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("No domain connected");
  });

  it("400: Resend API key missing even when domain ID exists", async () => {
    state.dbSelectQueue = [[OWNER], [WS_DOMAIN_NO_KEY]];

    const res = await post(makeApp(), "/verify");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("API key");
  });

  it("400: Resend verify returns error", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.verify = async () => ({
      data: null,
      error: { message: "Domain verification rate limit exceeded." },
    });

    const res = await post(makeApp(), "/verify");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("rate limit");
  });

  it("400: DB NOT updated when Resend verify fails", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.verify = async () => ({ data: null, error: { message: "Failed" } });

    await post(makeApp(), "/verify");
    expect(state.dbUpdateCaptures).toHaveLength(0);
  });
});

// ── POST /refresh ─────────────────────────────────────────────────────────────

describe("POST /refresh", () => {
  beforeEach(resetState);

  it("200: returns verified status and updated per-record statuses", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.get = async () => ({ data: RESEND_DOMAIN_VERIFIED, error: null });

    const res = await post(makeApp(), "/refresh");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("verified");
    expect(body.id).toBe("dom_abc123def456");
    expect(body.records.every((r: any) => r.status === "verified")).toBe(true);
  });

  it("200: DB updated with new status and records on refresh", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.get = async () => ({ data: RESEND_DOMAIN_VERIFIED, error: null });

    await post(makeApp(), "/refresh");

    expect(state.dbUpdateCaptures).toHaveLength(1);
    expect(state.dbUpdateCaptures[0].resendDomainStatus).toBe("verified");
    expect(Array.isArray(state.dbUpdateCaptures[0].resendDomainRecords)).toBe(true);
    expect(state.dbUpdateCaptures[0].updatedAt).toBeInstanceOf(Date);
  });

  it("200: reflects pending status (DNS still propagating)", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.get = async () => ({
      data: { ...RESEND_DOMAIN_VERIFIED, status: "pending" },
      error: null,
    });

    const res = await post(makeApp(), "/refresh");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pending");
  });

  it("200: reflects failed status", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.get = async () => ({
      data: { ...RESEND_DOMAIN_VERIFIED, status: "failed" },
      error: null,
    });

    const res = await post(makeApp(), "/refresh");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("failed");
  });

  it("200: reflects temporary_failure status", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.get = async () => ({
      data: { ...RESEND_DOMAIN_VERIFIED, status: "temporary_failure" },
      error: null,
    });

    const res = await post(makeApp(), "/refresh");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("temporary_failure");
  });

  it("403: member cannot refresh", async () => {
    state.dbSelectQueue = [[MEMBER]];
    const res = await post(makeApp(), "/refresh");
    expect(res.status).toBe(403);
  });

  it("403: no membership is forbidden", async () => {
    state.dbSelectQueue = [[]];
    const res = await post(makeApp(), "/refresh");
    expect(res.status).toBe(403);
  });

  it("400: no domain connected", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_NO_DOMAIN]];
    const res = await post(makeApp(), "/refresh");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("No domain");
  });

  it("400: no Resend API key", async () => {
    state.dbSelectQueue = [[OWNER], [WS_DOMAIN_NO_KEY]];
    const res = await post(makeApp(), "/refresh");
    expect(res.status).toBe(400);
  });

  it("400: Resend GET returns error (e.g. rate limit)", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.get = async () => ({
      data: null,
      error: { message: "Too many requests. Please slow down." },
    });

    const res = await post(makeApp(), "/refresh");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("slow down");
  });

  it("400: Resend GET returns null data without error", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.get = async () => ({ data: null, error: null });

    const res = await post(makeApp(), "/refresh");
    expect(res.status).toBe(400);
  });

  it("400: DB NOT updated when Resend fetch fails", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.get = async () => ({ data: null, error: { message: "error" } });

    await post(makeApp(), "/refresh");
    expect(state.dbUpdateCaptures).toHaveLength(0);
  });
});

// ── DELETE / ──────────────────────────────────────────────────────────────────

describe("DELETE /", () => {
  beforeEach(resetState);

  it("204: owner disconnects domain, all columns cleared in DB", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.remove = async () => ({ data: {}, error: null });

    const res = await del(makeApp(), "/");
    expect(res.status).toBe(204);

    expect(state.dbUpdateCaptures).toHaveLength(1);
    const cleared = state.dbUpdateCaptures[0];
    expect(cleared.resendDomainId).toBeNull();
    expect(cleared.resendDomainName).toBeNull();
    expect(cleared.resendDomainStatus).toBeNull();
    expect(cleared.resendDomainRecords).toBeNull();
    expect(cleared.updatedAt).toBeInstanceOf(Date);
  });

  it("204: idempotent — domain already deleted in Resend (not found) still clears DB", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.remove = async () => ({
      data: null,
      error: { message: "Domain not found" },
    });

    const res = await del(makeApp(), "/");
    expect(res.status).toBe(204);

    // DB should still be cleared even though Resend returned 404
    expect(state.dbUpdateCaptures).toHaveLength(1);
    expect(state.dbUpdateCaptures[0].resendDomainId).toBeNull();
  });

  it("204: case-insensitive not-found detection clears DB", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.remove = async () => ({
      data: null,
      error: { message: "The requested domain was NOT FOUND." },
    });

    const res = await del(makeApp(), "/");
    expect(res.status).toBe(204);
    expect(state.dbUpdateCaptures).toHaveLength(1);
  });

  it("204: admin can disconnect domain", async () => {
    state.dbSelectQueue = [[ADMIN], [WS_KEY_WITH_DOMAIN]];
    state.resend.remove = async () => ({ data: {}, error: null });

    const res = await del(makeApp(), "/");
    expect(res.status).toBe(204);
  });

  it("400: Resend remove returns a non-404 error blocks disconnect", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.remove = async () => ({
      data: null,
      error: { message: "Internal server error occurred." },
    });

    const res = await del(makeApp(), "/");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Internal server error");
  });

  it("400: Resend error without 'not found' does NOT clear DB", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.remove = async () => ({
      data: null,
      error: { message: "Access denied." },
    });

    await del(makeApp(), "/");
    expect(state.dbUpdateCaptures).toHaveLength(0);
  });

  it("403: member cannot disconnect domain", async () => {
    state.dbSelectQueue = [[MEMBER]];
    const res = await del(makeApp(), "/");
    expect(res.status).toBe(403);
  });

  it("403: no membership is forbidden", async () => {
    state.dbSelectQueue = [[]];
    const res = await del(makeApp(), "/");
    expect(res.status).toBe(403);
  });

  it("400: no domain connected to disconnect", async () => {
    state.dbSelectQueue = [[OWNER], [WS_KEY_NO_DOMAIN]];
    const res = await del(makeApp(), "/");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("No domain connected");
  });

  it("400: no Resend API key when trying to disconnect", async () => {
    state.dbSelectQueue = [[OWNER], [WS_DOMAIN_NO_KEY]];
    const res = await del(makeApp(), "/");
    expect(res.status).toBe(400);
  });
});

// ── Domain name validation (Zod regex) ───────────────────────────────────────

describe("domain name validation via POST /connect", () => {
  beforeEach(resetState);

  const VALID: string[] = [
    "example.com",
    "mail.example.com",
    "sub.mail.example.com",
    "my-app.io",
    "xn--nxasmq6b.com", // IDN encoded
    "a.bc",
    "123.co.uk",
    "send.my-startup.app",
  ];

  const INVALID: string[] = [
    "",
    "a",          // no dot
    "COM",        // single label
    "nodot",      // no TLD
    "-lead.com",  // leading hyphen
    "trail-.com", // trailing hyphen
    ".dot.com",   // leading dot
    "mail..com",  // double dot
    "mail .com",  // space
  ];

  for (const domain of VALID) {
    it(`accepts '${domain}'`, async () => {
      // For valid domains, the route proceeds past Zod and hits the DB/Resend
      // mock. We just need to confirm it's NOT a 400 from validation.
      state.dbSelectQueue = [[OWNER], [WS_KEY_NO_DOMAIN]];
      state.resend.create = async () => ({
        data: { ...RESEND_DOMAIN_CREATED, name: domain },
        error: null,
      });

      const res = await post(makeApp(), "/connect", { domainName: domain });
      // 201 means Zod accepted + Resend succeeded
      expect(res.status).toBe(201);
    });
  }

  for (const domain of INVALID) {
    it(`rejects '${domain}'`, async () => {
      const res = await post(makeApp(), "/connect", { domainName: domain });
      expect(res.status).toBe(400);
    });
  }
});

// ── Full end-to-end flow simulation ──────────────────────────────────────────

describe("full domain lifecycle flow", () => {
  beforeEach(resetState);

  it("connect → verify → refresh(verified) — happy path all steps work", async () => {
    const app = makeApp();

    // Step 1: Connect domain
    state.dbSelectQueue = [[OWNER], [WS_KEY_NO_DOMAIN]];
    state.resend.create = async () => ({ data: RESEND_DOMAIN_CREATED, error: null });

    const connectRes = await post(app, "/connect", { domainName: "mail.example.com" });
    expect(connectRes.status).toBe(201);
    const connectBody = await connectRes.json();
    expect(connectBody.records).toHaveLength(3);

    // Step 2: Trigger verification
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.verify = async () => ({ data: { object: "domain", id: "dom_abc123def456" }, error: null });

    const verifyRes = await post(app, "/verify");
    expect(verifyRes.status).toBe(200);
    expect((await verifyRes.json()).status).toBe("pending");

    // Step 3: Refresh — domain is now verified
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.get = async () => ({ data: RESEND_DOMAIN_VERIFIED, error: null });

    const refreshRes = await post(app, "/refresh");
    expect(refreshRes.status).toBe(200);
    const refreshBody = await refreshRes.json();
    expect(refreshBody.status).toBe("verified");
    expect(refreshBody.records.every((r: any) => r.status === "verified")).toBe(true);
  });

  it("connect → disconnect — DB cleared after removal", async () => {
    const app = makeApp();

    // Connect
    state.dbSelectQueue = [[OWNER], [WS_KEY_NO_DOMAIN]];
    state.resend.create = async () => ({ data: RESEND_DOMAIN_CREATED, error: null });
    await post(app, "/connect", { domainName: "mail.example.com" });
    state.dbUpdateCaptures = []; // reset capture after connect

    // Disconnect
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.remove = async () => ({ data: {}, error: null });
    const res = await del(app, "/");

    expect(res.status).toBe(204);
    expect(state.dbUpdateCaptures[0].resendDomainId).toBeNull();
    expect(state.dbUpdateCaptures[0].resendDomainName).toBeNull();
  });

  it("connect → verify fails → retry verify succeeds", async () => {
    const app = makeApp();

    // Connect
    state.dbSelectQueue = [[OWNER], [WS_KEY_NO_DOMAIN]];
    state.resend.create = async () => ({ data: RESEND_DOMAIN_CREATED, error: null });
    await post(app, "/connect", { domainName: "mail.example.com" });

    // First verify attempt fails
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.verify = async () => ({ data: null, error: { message: "Temporary failure" } });
    const failRes = await post(app, "/verify");
    expect(failRes.status).toBe(400);

    // Retry verify succeeds
    state.dbSelectQueue = [[OWNER], [WS_KEY_WITH_DOMAIN]];
    state.resend.verify = async () => ({ data: { object: "domain", id: "dom_abc123def456" }, error: null });
    const retryRes = await post(app, "/verify");
    expect(retryRes.status).toBe(200);
  });
});
