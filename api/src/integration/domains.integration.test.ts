/**
 * Real integration tests for the Sending Domain API.
 *
 * Strategy (no fake module mocks):
 *   ✓ Real PostgreSQL — Docker container (postgres:16-alpine, port 5433)
 *   ✓ Real Hono app  — in-process via app.request(), full middleware stack
 *   ✓ Real BetterAuth — actual sign-up, session cookies, password hashing
 *   ✓ Real Drizzle ORM — actual queries against real schema
 *   ✓ Real Zod validation — runs end-to-end in route handlers
 *   ✓ Real business logic — workspace creation hook, auth guard, etc.
 *   ~ Resend HTTP boundary — intercepted at the global fetch level only;
 *     the Resend SDK constructor, request building, and response parsing
 *     all run for real. Only the outbound call to api.resend.com is swapped.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import postgres from "postgres";
import path from "path";

// ── Environment (must be set before any lazy-init is triggered) ──────────────
const TEST_DB_URL =
  "postgresql://openmail:openmail_password@127.0.0.1:5433/openmail_test";

process.env.DATABASE_URL = TEST_DB_URL;
process.env.BETTER_AUTH_SECRET = "integration-test-secret-abc123xyz456def"; // pragma: allowlist secret
process.env.BETTER_AUTH_URL = "http://localhost:3001"; // pragma: allowlist secret
process.env.WEB_URL = "http://localhost:5173"; // pragma: allowlist secret
process.env.DEFAULT_FROM_EMAIL = "noreply@openmail.dev";

// ── Resend HTTP interceptor ───────────────────────────────────────────────────
// Intercepts outbound calls to api.resend.com at the global fetch level.
// The Resend SDK still runs for real: constructor, request serialization, and
// response deserialization all execute. Only the network boundary is swapped.

type ResendScenario = { status: number; body: object };
let resendScenario: ResendScenario | null = null;

const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const url = input.toString();
  if (url.startsWith("https://api.resend.com/")) {
    const scenario = resendScenario;
    if (scenario) {
      return new Response(JSON.stringify(scenario.body), {
        status: scenario.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Default: no interceptor set → return a generic 500
    return new Response(
      JSON.stringify({ name: "test_error", message: "Resend interceptor not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  return realFetch(input, init);
};

// ── Resend fixture responses ──────────────────────────────────────────────────

const DNS_RECORDS = [
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
    name: "abc123._domainkey",
    type: "CNAME",
    ttl: "Auto",
    status: "not_started",
    value: "abc123.dkim.amazonses.com.",
  },
];

function domainCreated(name = "mail.example.com"): ResendScenario {
  return {
    status: 201,
    body: {
      id: "dom_test_integration_01",
      name,
      status: "not_started",
      records: DNS_RECORDS,
      region: "us-east-1",
    },
  };
}

const verifyOk: ResendScenario = {
  status: 200,
  body: { object: "domain", id: "dom_test_integration_01" },
};

function domainStatus(status: string): ResendScenario {
  return {
    status: 200,
    body: {
      id: "dom_test_integration_01",
      name: "mail.example.com",
      status,
      records: DNS_RECORDS.map((r) => ({ ...r, status })),
      region: "us-east-1",
    },
  };
}

const removeOk: ResendScenario = {
  status: 200,
  body: { object: "domain", id: "dom_test_integration_01" },
};

// ── Docker + DB lifecycle ─────────────────────────────────────────────────────

const CONTAINER_NAME = "openmail-integration-test-pg";

async function spawnWait(cmd: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  return { code, stdout: stdout.trim() };
}

async function startTestDb() {
  // Remove any leftover container from a previous run
  await spawnWait(["docker", "rm", "-f", CONTAINER_NAME]);

  const { code } = await spawnWait([
    "docker", "run", "-d",
    "--name", CONTAINER_NAME,
    "-e", "POSTGRES_DB=openmail_test",
    "-e", "POSTGRES_USER=openmail",
    "-e", "POSTGRES_PASSWORD=openmail_password",
    "-p", "5433:5432",
    "postgres:16-alpine",
  ]);
  if (code !== 0) throw new Error(`Failed to start Docker container (exit ${code})`);
}

async function waitForDb(maxRetries = 40): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    const pg = postgres(TEST_DB_URL, { max: 1, connect_timeout: 2, idle_timeout: 1 });
    try {
      await pg`SELECT 1`;
      await pg.end();
      return;
    } catch {
      await pg.end({ timeout: 1 }).catch(() => {});
      await Bun.sleep(1000);
    }
  }
  throw new Error("Database did not become ready within 40 seconds");
}

async function runMigrations(rawDb: postgres.Sql) {
  const dir = path.join(import.meta.dir, "../../../packages/shared/drizzle");
  const files = [
    "0000_woozy_sharon_ventura.sql",
    "0001_sending_domains.sql",
  ];
  for (const file of files) {
    const sql = await Bun.file(path.join(dir, file)).text();
    // Drizzle uses "--> statement-breakpoint" to separate statements
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await rawDb.unsafe(stmt);
    }
  }
}

async function stopTestDb() {
  await spawnWait(["docker", "rm", "-f", CONTAINER_NAME]);
}

// ── Test state ────────────────────────────────────────────────────────────────

let rawDb: postgres.Sql;
let app: any; // Hono app

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse Set-Cookie response header → Cookie request header string */
function cookieHeader(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  if (!setCookie) return "";
  // Set-Cookie values: "name=value; HttpOnly; ..." — we need only "name=value"
  // Multiple cookies may be joined with newlines in bun's Response.headers
  return setCookie
    .split(/,(?=\s*[a-zA-Z0-9_-]+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function req(
  path: string,
  opts: { method?: string; cookie?: string; body?: object } = {}
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body) headers["Content-Type"] = "application/json";
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  return app.request(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

/** Create a real user via BetterAuth sign-up, return session cookie + user id */
async function signUp(suffix = "") {
  const email = `user_${suffix}_${Date.now()}@test.example.com`;
  const name = `Test User ${suffix}`;
  const password = "TestPassword123!";

  const res = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { email, password, name },
  });

  if (res.status !== 200) {
    const text = await res.text();
    throw new Error(`Sign-up failed (${res.status}): ${text}`);
  }

  const cookie = cookieHeader(res);
  const body = await res.json() as any;
  return { email, password, cookie, userId: body.user?.id };
}

/** Get first workspace for the signed-in user */
async function getWorkspace(cookie: string) {
  const res = await req("/api/session/workspaces", { cookie });
  const list = await res.json() as any[];
  return list[0];
}

/** PATCH workspace to set resendApiKey (returns updated workspace) */
async function setResendKey(cookie: string, wsId: string, key = "re_test_key_integration") {
  const res = await req(`/api/session/workspaces/${wsId}`, {
    method: "PATCH",
    cookie,
    body: { resendApiKey: key },
  });
  return res;
}

/** Query the workspaces table directly to verify DB state */
async function dbWorkspace(wsId: string) {
  const [row] = await rawDb`SELECT * FROM workspaces WHERE id = ${wsId}`;
  return row;
}

/** Truncate auth + workspace tables to get a clean slate for each test */
async function cleanDb() {
  // CASCADE handles: session, account, workspace_members, api_keys, etc.
  await rawDb`TRUNCATE "user", workspaces RESTART IDENTITY CASCADE`;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestDb();
  await waitForDb();

  rawDb = postgres(TEST_DB_URL, { max: 5 });
  await runMigrations(rawDb);

  // Dynamic import AFTER env vars and DB are ready
  const mod = await import("../index.js");
  app = mod.app;
}, 120_000);

afterAll(async () => {
  await rawDb?.end({ timeout: 5 }).catch(() => {});
  await stopTestDb();
}, 30_000);

beforeEach(async () => {
  await cleanDb();
  resendScenario = null;
});

// ═════════════════════════════════════════════════════════════════════════════
// AUTH + WORKSPACE SETUP (real BetterAuth, real DB)
// ═════════════════════════════════════════════════════════════════════════════

describe("auth and workspace setup", () => {
  it("sign-up creates user, session cookie, and auto-workspace", async () => {
    const { cookie, userId } = await signUp("setup");

    expect(cookie).toContain("="); // session cookie is present

    // The BetterAuth databaseHook created a workspace automatically
    const ws = await getWorkspace(cookie);
    expect(ws).toBeDefined();
    expect(ws.id).toMatch(/^ws_/);
    expect(ws.name).toContain("Test User");

    // Verify DB has the workspace + member row
    const [member] = await rawDb`
      SELECT wm.role FROM workspace_members wm
      WHERE wm.workspace_id = ${ws.id}
        AND wm.user_id = ${userId}`;
    expect(member?.role).toBe("owner");
  });

  it("session cookie is accepted on authenticated routes", async () => {
    const { cookie } = await signUp("session");
    const res = await req("/api/session/workspaces", { cookie });
    expect(res.status).toBe(200);
  });

  it("request without session cookie returns 401", async () => {
    const res = await req("/api/session/workspaces");
    expect(res.status).toBe(401);
  });

  it("PATCH workspace sets resendApiKey (not returned in safe columns)", async () => {
    const { cookie } = await signUp("patch");
    const ws = await getWorkspace(cookie);
    const res = await setResendKey(cookie, ws.id);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // resendApiKey must NEVER be returned
    expect(body.resendApiKey).toBeUndefined();
    // But safe fields are returned
    expect(body.id).toBe(ws.id);

    // Verify key is in DB
    const row = await dbWorkspace(ws.id);
    expect(row.resend_api_key).toBe("re_test_key_integration");
  });

  it("PATCH workspace by plain member returns 403", async () => {
    const owner = await signUp("patch_owner");
    const ws = await getWorkspace(owner.cookie);

    // Sign up a second user who is NOT a member of this workspace
    const outsider = await signUp("patch_outsider");
    const res = await req(`/api/session/workspaces/${ws.id}`, {
      method: "PATCH",
      cookie: outsider.cookie,
      body: { resendApiKey: "re_bad_key" },
    });
    expect(res.status).toBe(403);
  });

  it("domain fields present (null) in workspace list response", async () => {
    const { cookie } = await signUp("domfields");
    const ws = await getWorkspace(cookie);
    expect(ws.resendDomainName).toBeNull();
    expect(ws.resendDomainStatus).toBeNull();
    expect(ws.resendDomainRecords).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /domains/connect
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /domains/connect", () => {
  it("201: connects domain, response has id/name/status/records", async () => {
    const { cookie } = await signUp("conn1");
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);
    resendScenario = domainCreated();

    const res = await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "mail.example.com" },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBe("dom_test_integration_01");
    expect(body.name).toBe("mail.example.com");
    expect(body.status).toBe("not_started");
    expect(body.records).toHaveLength(3);
    expect(body.records[0].type).toBe("MX");
    expect(body.records[1].type).toBe("TXT");
    expect(body.records[2].type).toBe("CNAME");
  });

  it("201: DB stores domain id, name, status, and records JSONB", async () => {
    const { cookie } = await signUp("conn2");
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);
    resendScenario = domainCreated();

    await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "mail.example.com" },
    });

    const row = await dbWorkspace(ws.id);
    expect(row.resend_domain_id).toBe("dom_test_integration_01");
    expect(row.resend_domain_name).toBe("mail.example.com");
    expect(row.resend_domain_status).toBe("not_started");
    expect(Array.isArray(row.resend_domain_records)).toBe(true);
    expect(row.resend_domain_records).toHaveLength(3);
  });

  it("201: workspace list now shows domain name and status", async () => {
    const { cookie } = await signUp("conn3");
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);
    resendScenario = domainCreated();

    await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "mail.example.com" },
    });

    const updatedWs = await getWorkspace(cookie);
    expect(updatedWs.resendDomainName).toBe("mail.example.com");
    expect(updatedWs.resendDomainStatus).toBe("not_started");
    expect(updatedWs.resendDomainRecords).toHaveLength(3);
    // resendDomainId must NOT be in safe columns
    expect(updatedWs.resendDomainId).toBeUndefined();
  });

  it("400: returns error when workspace has no Resend API key", async () => {
    const { cookie } = await signUp("conn4");
    const ws = await getWorkspace(cookie);
    // Do NOT set resendApiKey

    const res = await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "mail.example.com" },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("Resend API key");
  });

  it("409: second connect attempt while domain is already linked", async () => {
    const { cookie } = await signUp("conn5");
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);
    resendScenario = domainCreated();

    // First connect
    await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "mail.example.com" },
    });

    // Second connect attempt
    const res2 = await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "other.example.com" },
    });

    expect(res2.status).toBe(409);
    expect((await res2.json() as any).error).toContain("already connected");
  });

  it("400: Resend returns error (e.g. domain in another account)", async () => {
    const { cookie } = await signUp("conn6");
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);
    resendScenario = {
      status: 422,
      body: { name: "validation_error", message: "Domain is already in use by another Resend account." },
    };

    const res = await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "taken.example.com" },
    });

    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("another Resend account");
    // DB must NOT have been updated
    const row = await dbWorkspace(ws.id);
    expect(row.resend_domain_id).toBeNull();
  });

  it("403: plain member of a DIFFERENT workspace cannot connect", async () => {
    const owner = await signUp("conn7_owner");
    const outsider = await signUp("conn7_out");
    const ownerWs = await getWorkspace(owner.cookie);

    const res = await req(`/api/session/ws/${ownerWs.id}/domains/connect`, {
      method: "POST",
      cookie: outsider.cookie,
      body: { domainName: "mail.example.com" },
    });

    expect(res.status).toBe(403);
  });

  it("401: unauthenticated request is rejected", async () => {
    const res = await req("/api/session/ws/ws_fake/domains/connect", {
      method: "POST",
      body: { domainName: "mail.example.com" },
    });
    expect(res.status).toBe(401);
  });

  it("400: Zod rejects empty domain name", async () => {
    const { cookie } = await signUp("conn8");
    const ws = await getWorkspace(cookie);

    const res = await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "" },
    });
    expect(res.status).toBe(400);
  });

  it("400: Zod rejects bare hostname without dot", async () => {
    const { cookie } = await signUp("conn9");
    const ws = await getWorkspace(cookie);

    const res = await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "justhostname" },
    });
    expect(res.status).toBe(400);
  });

  it("400: Zod rejects domain with leading hyphen", async () => {
    const { cookie } = await signUp("conn10");
    const ws = await getWorkspace(cookie);

    const res = await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "-bad.example.com" },
    });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /domains/verify
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /domains/verify", () => {
  async function setupWithDomain(tag: string) {
    const { cookie } = await signUp(tag);
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);
    resendScenario = domainCreated();
    await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "mail.example.com" },
    });
    return { cookie, ws };
  }

  it("200: triggers verification, status becomes pending in DB", async () => {
    const { cookie, ws } = await setupWithDomain("ver1");
    resendScenario = verifyOk;

    const res = await req(`/api/session/ws/${ws.id}/domains/verify`, {
      method: "POST",
      cookie,
    });

    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe("pending");

    const row = await dbWorkspace(ws.id);
    expect(row.resend_domain_status).toBe("pending");
  });

  it("200: domain records still in DB after verify call", async () => {
    const { cookie, ws } = await setupWithDomain("ver2");
    resendScenario = verifyOk;

    await req(`/api/session/ws/${ws.id}/domains/verify`, {
      method: "POST",
      cookie,
    });

    const row = await dbWorkspace(ws.id);
    expect(Array.isArray(row.resend_domain_records)).toBe(true);
    expect(row.resend_domain_records).toHaveLength(3);
  });

  it("400: verify without any domain connected", async () => {
    const { cookie } = await signUp("ver3");
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);

    const res = await req(`/api/session/ws/${ws.id}/domains/verify`, {
      method: "POST",
      cookie,
    });

    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("No domain connected");
  });

  it("400: verify when workspace has no Resend API key", async () => {
    const { cookie } = await signUp("ver4");
    const ws = await getWorkspace(cookie);
    // Manually insert a domain_id without setting the API key
    await rawDb`UPDATE workspaces SET resend_domain_id = 'dom_orphan', resend_domain_name = 'mail.example.com', resend_domain_status = 'not_started' WHERE id = ${ws.id}`;

    const res = await req(`/api/session/ws/${ws.id}/domains/verify`, {
      method: "POST",
      cookie,
    });

    expect(res.status).toBe(400);
  });

  it("400: Resend verify returns an error", async () => {
    const { cookie, ws } = await setupWithDomain("ver5");
    resendScenario = {
      status: 422,
      body: { name: "validation_error", message: "DNS verification rate limit exceeded." },
    };

    const res = await req(`/api/session/ws/${ws.id}/domains/verify`, {
      method: "POST",
      cookie,
    });

    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("rate limit");
    // Status must NOT have been changed to pending
    const row = await dbWorkspace(ws.id);
    expect(row.resend_domain_status).toBe("not_started");
  });

  it("403: outsider cannot trigger verify on another workspace", async () => {
    const owner = await signUp("ver6_own");
    const outsider = await signUp("ver6_out");
    const ws = await getWorkspace(owner.cookie);

    const res = await req(`/api/session/ws/${ws.id}/domains/verify`, {
      method: "POST",
      cookie: outsider.cookie,
    });

    expect(res.status).toBe(403);
  });

  it("401: unauthenticated verify is rejected", async () => {
    const res = await req("/api/session/ws/ws_fake/domains/verify", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /domains/refresh
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /domains/refresh", () => {
  async function setupWithPendingDomain(tag: string) {
    const { cookie } = await signUp(tag);
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);

    resendScenario = domainCreated();
    await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "mail.example.com" },
    });

    resendScenario = verifyOk;
    await req(`/api/session/ws/${ws.id}/domains/verify`, { method: "POST", cookie });

    return { cookie, ws };
  }

  it("200: refresh returns verified status and updates DB", async () => {
    const { cookie, ws } = await setupWithPendingDomain("ref1");
    resendScenario = domainStatus("verified");

    const res = await req(`/api/session/ws/${ws.id}/domains/refresh`, {
      method: "POST",
      cookie,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("verified");
    expect(body.records.every((r: any) => r.status === "verified")).toBe(true);

    const row = await dbWorkspace(ws.id);
    expect(row.resend_domain_status).toBe("verified");
  });

  it("200: refresh reflects pending when DNS not yet propagated", async () => {
    const { cookie, ws } = await setupWithPendingDomain("ref2");
    resendScenario = domainStatus("pending");

    const res = await req(`/api/session/ws/${ws.id}/domains/refresh`, { method: "POST", cookie });
    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe("pending");

    const row = await dbWorkspace(ws.id);
    expect(row.resend_domain_status).toBe("pending");
  });

  it("200: refresh reflects failed status", async () => {
    const { cookie, ws } = await setupWithPendingDomain("ref3");
    resendScenario = domainStatus("failed");

    const res = await req(`/api/session/ws/${ws.id}/domains/refresh`, { method: "POST", cookie });
    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe("failed");
  });

  it("200: refresh reflects temporary_failure status", async () => {
    const { cookie, ws } = await setupWithPendingDomain("ref4");
    resendScenario = domainStatus("temporary_failure");

    const res = await req(`/api/session/ws/${ws.id}/domains/refresh`, { method: "POST", cookie });
    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe("temporary_failure");
  });

  it("200: records array updated with per-record statuses from Resend", async () => {
    const { cookie, ws } = await setupWithPendingDomain("ref5");
    resendScenario = domainStatus("verified");

    await req(`/api/session/ws/${ws.id}/domains/refresh`, { method: "POST", cookie });

    const row = await dbWorkspace(ws.id);
    expect(row.resend_domain_records[0].status).toBe("verified");
    expect(row.resend_domain_records[1].status).toBe("verified");
    expect(row.resend_domain_records[2].status).toBe("verified");
  });

  it("400: refresh on workspace with no domain", async () => {
    const { cookie } = await signUp("ref6");
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);

    const res = await req(`/api/session/ws/${ws.id}/domains/refresh`, { method: "POST", cookie });
    expect(res.status).toBe(400);
  });

  it("400: Resend GET returns an error", async () => {
    const { cookie, ws } = await setupWithPendingDomain("ref7");
    resendScenario = {
      status: 429,
      body: { name: "rate_limit", message: "Too many requests." },
    };

    const res = await req(`/api/session/ws/${ws.id}/domains/refresh`, { method: "POST", cookie });
    expect(res.status).toBe(400);

    // DB must remain unchanged (still "pending" from setup)
    const row = await dbWorkspace(ws.id);
    expect(row.resend_domain_status).toBe("pending");
  });

  it("403: outsider cannot refresh another workspace domain", async () => {
    const owner = await signUp("ref8_own");
    const outsider = await signUp("ref8_out");
    const ws = await getWorkspace(owner.cookie);

    const res = await req(`/api/session/ws/${ws.id}/domains/refresh`, {
      method: "POST",
      cookie: outsider.cookie,
    });
    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /domains
// ═════════════════════════════════════════════════════════════════════════════

describe("DELETE /domains", () => {
  async function setupWithConnectedDomain(tag: string) {
    const { cookie } = await signUp(tag);
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);
    resendScenario = domainCreated();
    await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "mail.example.com" },
    });
    return { cookie, ws };
  }

  it("204: disconnects domain and clears all 4 domain columns in DB", async () => {
    const { cookie, ws } = await setupWithConnectedDomain("del1");
    resendScenario = removeOk;

    const res = await req(`/api/session/ws/${ws.id}/domains`, {
      method: "DELETE",
      cookie,
    });

    expect(res.status).toBe(204);

    const row = await dbWorkspace(ws.id);
    expect(row.resend_domain_id).toBeNull();
    expect(row.resend_domain_name).toBeNull();
    expect(row.resend_domain_status).toBeNull();
    expect(row.resend_domain_records).toBeNull();
  });

  it("204: workspace list shows null domain fields after disconnect", async () => {
    const { cookie, ws } = await setupWithConnectedDomain("del2");
    resendScenario = removeOk;

    await req(`/api/session/ws/${ws.id}/domains`, { method: "DELETE", cookie });

    const updatedWs = await getWorkspace(cookie);
    expect(updatedWs.resendDomainName).toBeNull();
    expect(updatedWs.resendDomainStatus).toBeNull();
    expect(updatedWs.resendDomainRecords).toBeNull();
  });

  it("204: idempotent — Resend 'not found' still clears DB", async () => {
    const { cookie, ws } = await setupWithConnectedDomain("del3");
    resendScenario = {
      status: 404,
      body: { name: "not_found", message: "Domain not found in Resend." },
    };

    const res = await req(`/api/session/ws/${ws.id}/domains`, { method: "DELETE", cookie });
    expect(res.status).toBe(204);

    const row = await dbWorkspace(ws.id);
    expect(row.resend_domain_id).toBeNull();
  });

  it("400: non-404 Resend error blocks disconnect and preserves DB state", async () => {
    const { cookie, ws } = await setupWithConnectedDomain("del4");
    resendScenario = {
      status: 500,
      body: { name: "internal_server_error", message: "Resend internal server error." },
    };

    const res = await req(`/api/session/ws/${ws.id}/domains`, { method: "DELETE", cookie });
    expect(res.status).toBe(400);

    // DB should be UNCHANGED — domain still linked
    const row = await dbWorkspace(ws.id);
    expect(row.resend_domain_id).toBe("dom_test_integration_01");
  });

  it("400: disconnect when no domain is connected", async () => {
    const { cookie } = await signUp("del5");
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);

    const res = await req(`/api/session/ws/${ws.id}/domains`, { method: "DELETE", cookie });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("No domain connected");
  });

  it("400: disconnect when workspace has no Resend API key", async () => {
    const { cookie } = await signUp("del6");
    const ws = await getWorkspace(cookie);
    await rawDb`UPDATE workspaces SET resend_domain_id = 'dom_orphan' WHERE id = ${ws.id}`;

    const res = await req(`/api/session/ws/${ws.id}/domains`, { method: "DELETE", cookie });
    expect(res.status).toBe(400);
  });

  it("403: outsider cannot disconnect another workspace domain", async () => {
    const owner = await signUp("del7_own");
    const outsider = await signUp("del7_out");
    const ws = await getWorkspace(owner.cookie);

    const res = await req(`/api/session/ws/${ws.id}/domains`, {
      method: "DELETE",
      cookie: outsider.cookie,
    });
    expect(res.status).toBe(403);
  });

  it("401: unauthenticated delete is rejected", async () => {
    const res = await req("/api/session/ws/ws_fake/domains", { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FULL LIFECYCLE FLOWS
// ═════════════════════════════════════════════════════════════════════════════

describe("full domain lifecycle flows", () => {
  it("connect → verify → refresh(verified) — all steps succeed and DB reflects each change", async () => {
    const { cookie } = await signUp("life1");
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);

    // 1. Connect
    resendScenario = domainCreated();
    const c = await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "mail.example.com" },
    });
    expect(c.status).toBe(201);
    let row = await dbWorkspace(ws.id);
    expect(row.resend_domain_status).toBe("not_started");

    // 2. Verify
    resendScenario = verifyOk;
    const v = await req(`/api/session/ws/${ws.id}/domains/verify`, { method: "POST", cookie });
    expect(v.status).toBe(200);
    row = await dbWorkspace(ws.id);
    expect(row.resend_domain_status).toBe("pending");

    // 3. Refresh — verified
    resendScenario = domainStatus("verified");
    const r = await req(`/api/session/ws/${ws.id}/domains/refresh`, { method: "POST", cookie });
    expect(r.status).toBe(200);
    row = await dbWorkspace(ws.id);
    expect(row.resend_domain_status).toBe("verified");
  });

  it("connect → disconnect → reconnect works cleanly", async () => {
    const { cookie } = await signUp("life2");
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);

    // Connect
    resendScenario = domainCreated("mail.example.com");
    await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "mail.example.com" },
    });

    // Disconnect
    resendScenario = removeOk;
    const d = await req(`/api/session/ws/${ws.id}/domains`, { method: "DELETE", cookie });
    expect(d.status).toBe(204);

    let row = await dbWorkspace(ws.id);
    expect(row.resend_domain_id).toBeNull();

    // Reconnect with different subdomain
    resendScenario = domainCreated("send.example.com");
    const c2 = await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "send.example.com" },
    });
    expect(c2.status).toBe(201);

    row = await dbWorkspace(ws.id);
    expect(row.resend_domain_name).toBe("send.example.com");
  });

  it("failed verification → retry → succeeds", async () => {
    const { cookie } = await signUp("life3");
    const ws = await getWorkspace(cookie);
    await setResendKey(cookie, ws.id);

    resendScenario = domainCreated();
    await req(`/api/session/ws/${ws.id}/domains/connect`, {
      method: "POST",
      cookie,
      body: { domainName: "mail.example.com" },
    });

    // First verify attempt returns error
    resendScenario = { status: 422, body: { name: "error", message: "DNS propagation in progress" } };
    const v1 = await req(`/api/session/ws/${ws.id}/domains/verify`, { method: "POST", cookie });
    expect(v1.status).toBe(400);

    // Status unchanged
    let row = await dbWorkspace(ws.id);
    expect(row.resend_domain_status).toBe("not_started");

    // Retry verify — succeeds
    resendScenario = verifyOk;
    const v2 = await req(`/api/session/ws/${ws.id}/domains/verify`, { method: "POST", cookie });
    expect(v2.status).toBe(200);
    row = await dbWorkspace(ws.id);
    expect(row.resend_domain_status).toBe("pending");
  });

  it("multiple workspaces — each has independent domain state", async () => {
    const user = await signUp("life4");
    const ws1 = await getWorkspace(user.cookie);
    await setResendKey(user.cookie, ws1.id, "re_key_ws1");

    // Create second workspace
    const createRes = await req("/api/session/workspaces", {
      method: "POST",
      cookie: user.cookie,
      body: { name: "Second Workspace", slug: `second-ws-${Date.now()}` },
    });
    expect(createRes.status).toBe(201);
    const ws2 = (await createRes.json() as any);
    await setResendKey(user.cookie, ws2.id, "re_key_ws2");

    // Connect domain to ws1 only
    resendScenario = domainCreated("ws1.example.com");
    await req(`/api/session/ws/${ws1.id}/domains/connect`, {
      method: "POST",
      cookie: user.cookie,
      body: { domainName: "ws1.example.com" },
    });

    // ws1 has domain, ws2 has none
    const row1 = await dbWorkspace(ws1.id);
    const row2 = await dbWorkspace(ws2.id);
    expect(row1.resend_domain_name).toBe("ws1.example.com");
    expect(row2.resend_domain_id).toBeNull();
  });
});
