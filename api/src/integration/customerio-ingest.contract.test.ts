/**
 * Integration test — Stage 1 / T14 — Customer.io ingest contract
 *
 * Validates `api/src/routes/ingest.ts` accepts the Customer.io SDK shapes:
 *
 *   PUT  /api/ingest/cio/v1/customers/:id              { email, name?, ...attrs }
 *   POST /api/ingest/cio/v1/customers/:id              ditto (REST-style)
 *   POST /api/ingest/cio/v1/customers/:id/events       { name, data: { ... } }
 *   DELETE /api/ingest/cio/v1/customers/:id            (hard-delete)
 *   PUT  /api/ingest/cio/v1/objects/:type/:id          (group upsert)
 *   PUT  /api/ingest/cio/v1/objects/:type/:id/relationships  (link contacts)
 *
 * Auth (per ingest.ts:6): Customer.io uses Basic auth where the password is
 * the API key — `Authorization: Basic base64("anything:om_xxx")`.
 *
 * Plan SSOT: 03-plan.md lines 474-484.
 */
import "./_fixtures";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import {
  waitForDb,
  runMigrations,
  closeRawDb,
  cleanDb,
  flushRedis,
  getRawDb,
  createWorkspaceWithApiKey,
  createContact,
} from "./_fixtures";
import { __resetRateLimiterForTests } from "../lib/rate-limiter";

let app: any;

beforeAll(async () => {
  await waitForDb();
  await runMigrations();
  await flushRedis();
  const mod = await import("../index.js");
  app = mod.app;
}, 60_000);

afterAll(async () => {
  await __resetRateLimiterForTests();
  await closeRawDb();
}, 10_000);

beforeEach(async () => {
  await cleanDb();
  await flushRedis();
});

// Customer.io SDK uses Basic auth: base64("workspaceId:apiKey")
function basicAuth(apiKey: string, user = "site_id"): string {
  return `Basic ${Buffer.from(`${user}:${apiKey}`).toString("base64")}`;
}

async function cioReq(
  method: string,
  path: string,
  apiKey: string | null,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (apiKey) headers.Authorization = basicAuth(apiKey);
  return app.request(`/api/ingest${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("PUT /cio/v1/customers/:id — identify (Customer.io SDK default)", () => {
  it("200: creates new contact with email + attributes (id-as-email)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();

    const res = await cioReq("PUT", "/cio/v1/customers/alice@test.com", apiKey, {
      email: "alice@test.com",
      first_name: "Alice",
      last_name: "Smith",
      plan: "pro",
      signup_date: "2026-04-01",
    });
    expect(res.status).toBe(200);

    const db = getRawDb();
    const [c] = await db<
      Array<{
        email: string;
        first_name: string | null;
        last_name: string | null;
        attributes: Record<string, unknown>;
      }>
    >`SELECT email, first_name, last_name, attributes FROM contacts WHERE workspace_id = ${workspaceId}`;
    expect(c.email).toBe("alice@test.com");
    expect(c.first_name).toBe("Alice");
    expect(c.last_name).toBe("Smith");
    expect(c.attributes.plan).toBe("pro");
    expect(c.attributes.signup_date).toBe("2026-04-01");
  });

  it("200: also accepts POST (REST-style) for the same identify route", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const res = await cioReq("POST", "/cio/v1/customers/bob@test.com", apiKey, {
      email: "bob@test.com",
      name: "Bob Builder",
      role: "admin",
    });
    expect(res.status).toBe(200);

    const db = getRawDb();
    const [c] = await db<
      Array<{ email: string; first_name: string | null; last_name: string | null }>
    >`SELECT email, first_name, last_name FROM contacts WHERE workspace_id = ${workspaceId}`;
    expect(c.email).toBe("bob@test.com");
    // `name` is split into first/last
    expect(c.first_name).toBe("Bob");
    expect(c.last_name).toBe("Builder");
  });

  it("200: strips internal/security-sensitive fields before storing as attributes", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const res = await cioReq("PUT", "/cio/v1/customers/eve@test.com", apiKey, {
      email: "eve@test.com",
      // Each of these MUST be filtered (per ingest.ts:CIO_CONTACT_SKIP)
      id: "should_not_overwrite",
      workspace_id: "ws_other",
      workspaceId: "ws_other2",
      api_key: "om_should_not_leak",
      password: "should_not_leak",
      // legitimate attribute
      tier: "gold",
    });
    expect(res.status).toBe(200);

    const db = getRawDb();
    const [c] = await db<
      Array<{ attributes: Record<string, unknown>; id: string }>
    >`SELECT id, attributes FROM contacts WHERE workspace_id = ${workspaceId}`;
    expect(c.attributes.tier).toBe("gold");
    expect(c.attributes.id).toBeUndefined();
    expect(c.attributes.workspace_id).toBeUndefined();
    expect(c.attributes.workspaceId).toBeUndefined();
    expect(c.attributes.api_key).toBeUndefined();
    expect(c.attributes.password).toBeUndefined();
    // The contact's primary id must NOT have been clobbered by the body's id
    expect(c.id).not.toBe("should_not_overwrite");
    expect(c.id.startsWith("con_")).toBe(true);
  });

  it("400: identify with no email and non-email customer id is rejected", async () => {
    const { apiKey } = await createWorkspaceWithApiKey();
    const res = await cioReq("PUT", "/cio/v1/customers/cust_12345", apiKey, {
      first_name: "Anon",
      // no email
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/email/i);
  });

  it("400: invalid JSON body returns structured error", async () => {
    const { apiKey } = await createWorkspaceWithApiKey();
    const res = await app.request("/api/ingest/cio/v1/customers/x@test.com", {
      method: "PUT",
      headers: {
        Authorization: basicAuth(apiKey),
        "Content-Type": "application/json",
      },
      body: "not-json{",
    });
    expect(res.status).toBe(400);
  });

  it("401: missing API key is rejected", async () => {
    const res = await cioReq("PUT", "/cio/v1/customers/alice@test.com", null, {
      email: "alice@test.com",
    });
    expect(res.status).toBe(401);
  });

  it("401: invalid API key is rejected", async () => {
    const res = await cioReq(
      "PUT",
      "/cio/v1/customers/alice@test.com",
      "om_does_not_exist",
      { email: "alice@test.com" },
    );
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /cio/v1/customers/:id/events — track event", () => {
  it("200: records event with name → event_name, data → properties", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const contactId = await createContact(workspaceId, "alice@test.com");

    const res = await cioReq(
      "POST",
      "/cio/v1/customers/alice@test.com/events",
      apiKey,
      {
        name: "purchase_completed",
        data: { amount: 99, currency: "USD", item: "Pro Plan" },
      },
    );
    expect(res.status).toBe(200);

    const db = getRawDb();
    const [row] = await db<
      Array<{
        name: string;
        contact_id: string | null;
        contact_email: string | null;
        properties: Record<string, unknown>;
      }>
    >`SELECT name, contact_id, contact_email, properties FROM events WHERE workspace_id = ${workspaceId}`;
    expect(row.name).toBe("purchase_completed");
    expect(row.contact_id).toBe(contactId);
    expect(row.contact_email).toBe("alice@test.com");
    expect(row.properties.amount).toBe(99);
    expect(row.properties.currency).toBe("USD");
    expect(row.properties.item).toBe("Pro Plan");
  });

  it("400: missing event name is rejected", async () => {
    const { apiKey } = await createWorkspaceWithApiKey();
    const res = await cioReq(
      "POST",
      "/cio/v1/customers/alice@test.com/events",
      apiKey,
      { data: { amount: 1 } },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/name/i);
  });

  it("401: missing api key is rejected", async () => {
    const res = await cioReq(
      "POST",
      "/cio/v1/customers/alice@test.com/events",
      null,
      { name: "evt" },
    );
    expect(res.status).toBe(401);
  });

  it("200: events with no `data` field still recorded with empty properties", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    await createContact(workspaceId, "x@test.com");

    const res = await cioReq(
      "POST",
      "/cio/v1/customers/x@test.com/events",
      apiKey,
      { name: "page_viewed" },
    );
    expect(res.status).toBe(200);

    const db = getRawDb();
    const [row] = await db<
      Array<{ name: string; properties: Record<string, unknown> }>
    >`SELECT name, properties FROM events WHERE workspace_id = ${workspaceId}`;
    expect(row.name).toBe("page_viewed");
    expect(row.properties).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /cio/v1/customers/:id — hard delete", () => {
  it("200: hard-deletes contact by email", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    await createContact(workspaceId, "alice@test.com");

    const res = await cioReq(
      "DELETE",
      "/cio/v1/customers/alice@test.com",
      apiKey,
    );
    expect(res.status).toBe(200);

    const db = getRawDb();
    const rows = await db`SELECT id FROM contacts WHERE workspace_id = ${workspaceId}`;
    expect(rows).toHaveLength(0);
  });

  it("200: deleting non-existent contact is idempotent (200, no rows)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const res = await cioReq(
      "DELETE",
      "/cio/v1/customers/ghost@test.com",
      apiKey,
    );
    expect(res.status).toBe(200);
    const db = getRawDb();
    const rows = await db`SELECT id FROM contacts WHERE workspace_id = ${workspaceId}`;
    expect(rows).toHaveLength(0);
  });

  it("401: unauthenticated delete is rejected", async () => {
    const res = await cioReq("DELETE", "/cio/v1/customers/x@test.com", null);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("PUT /cio/v1/objects/:typeId/:id — group upsert (Customer.io Objects)", () => {
  it("200: creates company group with attributes (objectTypeId=1 → company)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();

    const res = await cioReq(
      "PUT",
      "/cio/v1/objects/1/acme",
      apiKey,
      { name: "Acme Corp", domain: "acme.com", plan: "enterprise" },
    );
    expect(res.status).toBe(200);

    const db = getRawDb();
    const [g] = await db<
      Array<{
        group_type: string;
        group_key: string;
        attributes: Record<string, unknown>;
      }>
    >`SELECT group_type, group_key, attributes FROM groups WHERE workspace_id = ${workspaceId}`;
    expect(g.group_type).toBe("company");
    expect(g.group_key).toBe("acme");
    expect(g.attributes.name).toBe("Acme Corp");
    expect(g.attributes.domain).toBe("acme.com");
  });

  it("200: also accepts POST (REST-style) for the same upsert route", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const res = await cioReq("POST", "/cio/v1/objects/1/widgetco", apiKey, {
      name: "Widget Co",
    });
    expect(res.status).toBe(200);

    const db = getRawDb();
    const [g] = await db`SELECT group_key FROM groups WHERE workspace_id = ${workspaceId}`;
    expect((g as any).group_key).toBe("widgetco");
  });

  it("200: strips internal/system fields before storing", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const res = await cioReq("PUT", "/cio/v1/objects/1/test_co", apiKey, {
      name: "Test Co",
      // each must be filtered out per CIO_OBJECT_SKIP_KEYS
      id: "grp_other",
      workspace_id: "ws_evil",
      group_type: "evil",
      api_key: "om_leak",
      password: "leak",
    });
    expect(res.status).toBe(200);

    const db = getRawDb();
    const [g] = await db<
      Array<{ id: string; group_type: string; attributes: Record<string, unknown> }>
    >`SELECT id, group_type, attributes FROM groups WHERE workspace_id = ${workspaceId}`;
    expect(g.id.startsWith("grp_")).toBe(true);
    expect(g.id).not.toBe("grp_other");
    expect(g.group_type).toBe("company");
    expect(g.attributes.name).toBe("Test Co");
    expect(g.attributes.id).toBeUndefined();
    expect(g.attributes.workspace_id).toBeUndefined();
    expect(g.attributes.api_key).toBeUndefined();
    expect(g.attributes.password).toBeUndefined();
    expect(g.attributes.group_type).toBeUndefined();
  });

  it("200: object types 1–4 map to company/account/team/project; unknown → object_type_N", async () => {
    const { apiKey } = await createWorkspaceWithApiKey();
    const checks: Array<[string, string]> = [
      ["1", "company"],
      ["2", "account"],
      ["3", "team"],
      ["4", "project"],
      ["99", "object_type_99"],
    ];
    for (const [tid, expected] of checks) {
      const res = await cioReq("PUT", `/cio/v1/objects/${tid}/grp_${tid}`, apiKey, {
        name: `Grp ${tid}`,
      });
      expect(res.status).toBe(200);
      const db = getRawDb();
      const rows = await db<
        Array<{ group_type: string }>
      >`SELECT group_type FROM groups WHERE group_key = ${`grp_${tid}`}`;
      expect(rows[0].group_type).toBe(expected);
    }
  });

  it("401: missing api key is rejected", async () => {
    const res = await cioReq("PUT", "/cio/v1/objects/1/acme", null, {
      name: "Acme",
    });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("PUT /cio/v1/objects/:typeId/:id/relationships — link contacts to group", () => {
  it("200: links existing contacts to a company group via email identifier", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    await createContact(workspaceId, "alice@acme.com");
    await createContact(workspaceId, "bob@acme.com");

    // First create the group
    await cioReq("PUT", "/cio/v1/objects/1/acme", apiKey, { name: "Acme" });

    const res = await cioReq(
      "PUT",
      "/cio/v1/objects/1/acme/relationships",
      apiKey,
      {
        relationships: [
          { identifiers: { email: "alice@acme.com" } },
          { identifiers: { email: "bob@acme.com" } },
        ],
      },
    );
    expect(res.status).toBe(200);

    const db = getRawDb();
    const links = await db<
      Array<{ contact_id: string; group_id: string }>
    >`SELECT cg.contact_id, cg.group_id
        FROM contact_groups cg
        WHERE cg.workspace_id = ${workspaceId}`;
    expect(links).toHaveLength(2);
  });

  it("400: invalid JSON body returns structured error", async () => {
    const { apiKey } = await createWorkspaceWithApiKey();
    const res = await app.request(
      "/api/ingest/cio/v1/objects/1/acme/relationships",
      {
        method: "PUT",
        headers: {
          Authorization: basicAuth(apiKey),
          "Content-Type": "application/json",
        },
        body: "not-json{",
      },
    );
    expect(res.status).toBe(400);
  });

  it("401: missing api key is rejected", async () => {
    const res = await cioReq(
      "PUT",
      "/cio/v1/objects/1/acme/relationships",
      null,
      { relationships: [] },
    );
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Workspace isolation — Customer.io ingest", () => {
  it("two workspaces with different API keys store contacts/events in their own row sets", async () => {
    const a = await createWorkspaceWithApiKey({ workspaceName: "WS A" });
    const b = await createWorkspaceWithApiKey({ workspaceName: "WS B" });

    await cioReq("PUT", "/cio/v1/customers/u@test.com", a.apiKey, {
      email: "u@test.com",
      tier: "a-tier",
    });
    await cioReq("PUT", "/cio/v1/customers/u@test.com", b.apiKey, {
      email: "u@test.com",
      tier: "b-tier",
    });

    const db = getRawDb();
    const aRows = await db<Array<{ attributes: Record<string, unknown> }>>`
      SELECT attributes FROM contacts WHERE workspace_id = ${a.workspaceId}
    `;
    const bRows = await db<Array<{ attributes: Record<string, unknown> }>>`
      SELECT attributes FROM contacts WHERE workspace_id = ${b.workspaceId}
    `;
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(1);
    expect(aRows[0].attributes.tier).toBe("a-tier");
    expect(bRows[0].attributes.tier).toBe("b-tier");
  });
});
