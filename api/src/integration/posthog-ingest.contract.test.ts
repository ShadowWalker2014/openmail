/**
 * Integration test — Stage 1 / T13 — PostHog ingest contract
 *
 * Validates `api/src/routes/ingest.ts` accepts the PostHog SDK shapes:
 *
 *   POST /api/ingest/capture   { api_key, event, distinct_id, properties, timestamp? }
 *   POST /api/ingest/batch     { api_key, batch: [...] }
 *   POST /api/ingest/identify  { api_key, distinct_id, properties: { $email, $name, ... } }
 *
 * Auth precedence (per ingest.ts:6):
 *   1. Authorization: Bearer
 *   2. api_key in JSON body
 *   3. Authorization: Basic
 *
 * Plan SSOT: 03-plan.md lines 460-470.
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

// Helper: HTTP request with Bearer auth.
async function ingest(
  path: string,
  apiKey: string | null,
  body: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return app.request(`/api/ingest${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/ingest/capture — PostHog single event", () => {
  it("200: stores event row with normalized name + contact resolution", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const contactId = await createContact(workspaceId, "alice@test.com");

    const res = await ingest("/capture", apiKey, {
      event: "$pageview",
      distinct_id: "alice@test.com",
      properties: { url: "https://app.test/dashboard", referrer: null },
      timestamp: "2026-04-29T12:00:00.000Z",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe(1); // PostHog success contract

    const db = getRawDb();
    const rows = await db<
      Array<{
        id: string;
        name: string;
        contact_id: string | null;
        contact_email: string | null;
        properties: Record<string, unknown>;
        occurred_at: Date;
      }>
    >`
      SELECT id, name, contact_id, contact_email, properties, occurred_at
      FROM events WHERE workspace_id = ${workspaceId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("$pageview");
    expect(rows[0].contact_id).toBe(contactId);
    expect(rows[0].contact_email).toBe("alice@test.com");
    expect(rows[0].properties).toMatchObject({
      url: "https://app.test/dashboard",
    });
    // PostHog timestamp is honoured
    expect(rows[0].occurred_at.toISOString()).toBe("2026-04-29T12:00:00.000Z");
  });

  it("200: anonymous distinct_id (no email) — event still recorded with null contact_id", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const res = await ingest("/capture", apiKey, {
      event: "anon_event",
      distinct_id: "anon-uuid-12345",
      properties: { source: "web" },
    });
    expect(res.status).toBe(200);

    const db = getRawDb();
    const [row] = await db<
      Array<{ name: string; contact_id: string | null; contact_email: string | null }>
    >`SELECT name, contact_id, contact_email FROM events WHERE workspace_id = ${workspaceId}`;
    expect(row.name).toBe("anon_event");
    expect(row.contact_id).toBeNull();
    // contactEmail is set to whatever distinct_id resolved to (the raw id) so
    // late identification can backfill it. This is per the route's resolution
    // logic: `email = ... ?? distinct_id`.
    expect(row.contact_email).toBe("anon-uuid-12345");
  });

  it("200: api_key in body (PostHog default) is accepted as auth", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    await createContact(workspaceId, "bob@test.com");

    const res = await app.request("/api/ingest/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event: "click",
        distinct_id: "bob@test.com",
        properties: {},
      }),
    });

    expect(res.status).toBe(200);
    const db = getRawDb();
    const [row] = await db`
      SELECT name FROM events WHERE workspace_id = ${workspaceId}
    `;
    expect(row.name).toBe("click");
  });

  it("400: malformed body (missing event) is rejected", async () => {
    const { apiKey } = await createWorkspaceWithApiKey();
    const res = await ingest("/capture", apiKey, {
      // event missing
      distinct_id: "alice@test.com",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/Validation/i);
  });

  it("400: invalid JSON body returns structured error", async () => {
    const { apiKey } = await createWorkspaceWithApiKey();
    const res = await app.request("/api/ingest/capture", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: "not-json{",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  it("401: missing API key is rejected", async () => {
    const res = await ingest("/capture", null, {
      event: "test",
      distinct_id: "alice@test.com",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/api key/i);
  });

  it("401: invalid API key is rejected", async () => {
    const res = await ingest("/capture", "om_invalid_does_not_exist", {
      event: "test",
      distinct_id: "alice@test.com",
    });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/ingest/batch — PostHog batch", () => {
  it("200: stores up to 100 events from a single batch", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    await createContact(workspaceId, "alice@test.com");

    const batch = Array.from({ length: 50 }, (_, i) => ({
      event: `evt_${i}`,
      distinct_id: "alice@test.com",
      properties: { idx: i },
    }));
    const res = await ingest("/batch", apiKey, { batch });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe(1);
    expect(body.ingested).toBe(50);
    expect(body.total).toBe(50);

    const db = getRawDb();
    const [{ count }] = await db<Array<{ count: string }>>`
      SELECT COUNT(*)::text as count FROM events WHERE workspace_id = ${workspaceId}
    `;
    expect(Number(count)).toBe(50);
  });

  it("400: batch size > 100 is rejected", async () => {
    const { apiKey } = await createWorkspaceWithApiKey();
    const batch = Array.from({ length: 101 }, (_, i) => ({
      event: `evt_${i}`,
      distinct_id: "x@test.com",
    }));
    const res = await ingest("/batch", apiKey, { batch });
    expect(res.status).toBe(400);
  });

  it("400: empty batch is rejected", async () => {
    const { apiKey } = await createWorkspaceWithApiKey();
    const res = await ingest("/batch", apiKey, { batch: [] });
    expect(res.status).toBe(400);
  });

  it("401: missing api key is rejected", async () => {
    const res = await ingest("/batch", null, {
      batch: [{ event: "e", distinct_id: "u@test.com" }],
    });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/ingest/identify — upsert contact attributes", () => {
  it("200: creates new contact from $email and $name", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const res = await ingest("/identify", apiKey, {
      distinct_id: "newuser_123",
      properties: {
        $email: "newuser@test.com",
        $name: "New User",
        plan: "pro",
        signup_source: "google",
      },
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
    expect(c.email).toBe("newuser@test.com");
    expect(c.first_name).toBe("New");
    expect(c.last_name).toBe("User");
    expect(c.attributes.plan).toBe("pro");
    expect(c.attributes.signup_source).toBe("google");
    // standard fields must NOT be duplicated into attributes
    expect(c.attributes.$email).toBeUndefined();
    expect(c.attributes.$name).toBeUndefined();
  });

  it("200: updates existing contact (upsert by email)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    await createContact(workspaceId, "existing@test.com");

    const res = await ingest("/identify", apiKey, {
      distinct_id: "existing@test.com",
      traits: {
        plan: "enterprise",
      },
    });
    expect(res.status).toBe(200);

    const db = getRawDb();
    const rows = await db<
      Array<{ attributes: Record<string, unknown> }>
    >`SELECT attributes FROM contacts WHERE workspace_id = ${workspaceId} AND email = 'existing@test.com'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].attributes.plan).toBe("enterprise");
  });

  it("400: missing distinct_id/userId is rejected", async () => {
    const { apiKey } = await createWorkspaceWithApiKey();
    const res = await ingest("/identify", apiKey, { properties: { foo: "bar" } });
    expect(res.status).toBe(400);
  });

  it("400: distinct_id without resolvable email is rejected", async () => {
    const { apiKey } = await createWorkspaceWithApiKey();
    const res = await ingest("/identify", apiKey, {
      distinct_id: "not-an-email-id",
      properties: {},
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/email/i);
  });

  it("401: missing api key is rejected", async () => {
    const res = await ingest("/identify", null, {
      distinct_id: "u@test.com",
    });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Workspace isolation — PostHog ingest", () => {
  it("two workspaces with different API keys store events in their own row sets", async () => {
    const a = await createWorkspaceWithApiKey({ workspaceName: "WS A" });
    const b = await createWorkspaceWithApiKey({ workspaceName: "WS B" });

    await ingest("/capture", a.apiKey, {
      event: "evt_a",
      distinct_id: "u@test.com",
      properties: {},
    });
    await ingest("/capture", b.apiKey, {
      event: "evt_b",
      distinct_id: "u@test.com",
      properties: {},
    });

    const db = getRawDb();
    const aRows = await db`SELECT name FROM events WHERE workspace_id = ${a.workspaceId}`;
    const bRows = await db`SELECT name FROM events WHERE workspace_id = ${b.workspaceId}`;
    expect(aRows.map((r) => (r as any).name)).toEqual(["evt_a"]);
    expect(bRows.map((r) => (r as any).name)).toEqual(["evt_b"]);
  });
});
