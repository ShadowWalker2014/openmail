/**
 * PostHog ingest contract tests (T13).
 *
 * Verifies that /api/ingest/* honors the PostHog SDK shapes that customers
 * expect when migrating. Source of truth: api/src/routes/ingest.ts.
 *
 * Endpoints covered:
 *   POST /api/ingest/capture   — single event
 *   POST /api/ingest/batch     — batch ≤ 100 events
 *   POST /api/ingest/identify  — upsert contact
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import postgres from "postgres";
import { setTestEnv, startContainers, stopContainers, waitForDb, waitForRedis, runMigrations, cleanDb, flushRedis, TEST_DB_URL } from "./_fixtures.js";
import { createHash } from "crypto";

setTestEnv();

let rawDb: postgres.Sql;
let app: any;

beforeAll(async () => {
  await startContainers();
  await waitForDb();
  await waitForRedis();
  rawDb = postgres(TEST_DB_URL, { max: 5 });
  await runMigrations(rawDb);
  const mod = await import("../index.js");
  app = mod.app;
}, 180_000);

afterAll(async () => {
  await rawDb?.end({ timeout: 5 }).catch(() => {});
  await stopContainers();
}, 30_000);

beforeEach(async () => {
  await cleanDb(rawDb);
  await flushRedis();
});

// ── Helpers ───────────────────────────────────────────────────────────────

async function makeWorkspaceWithApiKey() {
  const wsId = `ws_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const slug = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await rawDb`INSERT INTO workspaces (id, name, slug) VALUES (${wsId}, 'Test', ${slug})`;
  const rawKey = `om_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  await rawDb`INSERT INTO api_keys (id, workspace_id, name, key_hash, key_prefix)
    VALUES (${`key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`}, ${wsId}, 'test', ${keyHash}, ${rawKey.slice(0, 8)})`;
  return { wsId, apiKey: rawKey };
}

async function ingest(path: string, body: object, apiKey?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return app.request(`/api/ingest${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("PostHog ingest contract (T13)", () => {
  it("POST /capture with PostHog event shape returns 200 and creates event row", async () => {
    const { wsId, apiKey } = await makeWorkspaceWithApiKey();

    const res = await ingest("/capture", {
      event: "user_signed_up",
      distinct_id: "alice@example.com",
      properties: { plan: "pro" },
    }, apiKey);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe(1);

    // Wait for async event processing
    await Bun.sleep(500);
    const events = await rawDb`SELECT * FROM events WHERE workspace_id = ${wsId}` as any[];
    expect(events.length).toBe(1);
    expect(events[0].name).toBe("user_signed_up");
  });

  it("POST /batch with ≤100 events returns 200 and ingests all", async () => {
    const { wsId, apiKey } = await makeWorkspaceWithApiKey();

    const batch = Array.from({ length: 50 }, (_, i) => ({
      event: "page_view",
      distinct_id: `user_${i}@example.com`,
      properties: { page: `/p/${i}` },
    }));

    const res = await ingest("/batch", { batch }, apiKey);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe(1);
    expect(body.ingested).toBe(50);
    expect(body.total).toBe(50);

    await Bun.sleep(700);
    const [{ count }] = await rawDb`SELECT COUNT(*) AS count FROM events WHERE workspace_id = ${wsId}` as any[];
    expect(Number(count)).toBe(50);
  });

  it("POST /batch with > 100 events returns 400", async () => {
    const { apiKey } = await makeWorkspaceWithApiKey();
    const batch = Array.from({ length: 101 }, (_, i) => ({
      event: "page_view",
      distinct_id: `user_${i}@example.com`,
    }));
    const res = await ingest("/batch", { batch }, apiKey);
    expect(res.status).toBe(400);
  });

  it("POST /identify upserts contact", async () => {
    const { wsId, apiKey } = await makeWorkspaceWithApiKey();
    const res = await ingest("/identify", {
      distinct_id: "bob@example.com",
      properties: { $name: "Bob Smith", plan: "pro" },
    }, apiKey);

    expect(res.status).toBe(200);
    const [contact] = await rawDb`SELECT * FROM contacts WHERE workspace_id = ${wsId}` as any[];
    expect(contact.email).toBe("bob@example.com");
    expect(contact.first_name).toBe("Bob");
    expect(contact.last_name).toBe("Smith");
    expect(contact.attributes.plan).toBe("pro");
  });

  it("POST /capture without auth returns 401", async () => {
    const res = await ingest("/capture", {
      event: "anon",
      distinct_id: "x@example.com",
    });
    expect(res.status).toBe(401);
  });

  it("POST /identify without distinct_id returns 400", async () => {
    const { apiKey } = await makeWorkspaceWithApiKey();
    const res = await ingest("/identify", { traits: { foo: "bar" } }, apiKey);
    expect(res.status).toBe(400);
  });

  it("api_key in body (PostHog fallback) is accepted", async () => {
    const { wsId, apiKey } = await makeWorkspaceWithApiKey();
    const res = await ingest("/capture", {
      api_key: apiKey,
      event: "body_auth",
      distinct_id: "carol@example.com",
    });
    expect(res.status).toBe(200);
    await Bun.sleep(500);
    const events = await rawDb`SELECT * FROM events WHERE workspace_id = ${wsId}` as any[];
    expect(events[0].name).toBe("body_auth");
  });
});
