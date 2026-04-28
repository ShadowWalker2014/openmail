/**
 * Customer.io ingest contract tests (T14).
 *
 * Verifies /api/ingest/cio/v1/* honors the shapes the Customer.io SDK
 * actually sends. Source of truth: api/src/routes/ingest.ts:355+.
 *
 * Endpoints covered:
 *   PUT  /cio/v1/customers/:id              — identify
 *   POST /cio/v1/customers/:id/events       — track event
 *   DELETE /cio/v1/customers/:id            — hard-delete contact (audit fix API-4)
 *   PUT  /cio/v1/objects/:type/:id          — group upsert
 *   PUT  /cio/v1/objects/:type/:id/relationships — link contacts to group
 *
 * Auth: Customer.io uses Basic auth where the password is the api_key.
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

async function makeWorkspaceWithApiKey() {
  const wsId = `ws_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const slug = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await rawDb`INSERT INTO workspaces (id, name, slug) VALUES (${wsId}, 'Test', ${slug})`;
  const rawKey = `om_cio_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  await rawDb`INSERT INTO api_keys (id, workspace_id, name, key_hash, key_prefix)
    VALUES (${`key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`}, ${wsId}, 'cio', ${keyHash}, ${rawKey.slice(0, 8)})`;
  return { wsId, apiKey: rawKey };
}

/** Customer.io style: Basic auth with api_key as password */
function basicAuthHeader(apiKey: string) {
  return `Basic ${Buffer.from(`x:${apiKey}`).toString("base64")}`;
}

async function cioReq(method: string, path: string, apiKey: string, body?: object) {
  return app.request(`/api/ingest${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": basicAuthHeader(apiKey),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("Customer.io ingest contract (T14)", () => {
  it("PUT /cio/v1/customers/:id (Basic auth) creates contact with email-as-id", async () => {
    const { wsId, apiKey } = await makeWorkspaceWithApiKey();
    const res = await cioReq("PUT", "/cio/v1/customers/alice@example.com", apiKey, {
      name: "Alice Wonder",
      plan: "pro",
    });
    expect(res.status).toBe(200);

    const [contact] = await rawDb`SELECT * FROM contacts WHERE workspace_id = ${wsId}` as any[];
    expect(contact.email).toBe("alice@example.com");
    expect(contact.first_name).toBe("Alice");
    expect(contact.last_name).toBe("Wonder");
    expect(contact.attributes.plan).toBe("pro");
  });

  it("PUT /cio/v1/customers/:id strips internal/security fields from attributes", async () => {
    const { wsId, apiKey } = await makeWorkspaceWithApiKey();
    await cioReq("PUT", "/cio/v1/customers/bob@example.com", apiKey, {
      name: "Bob",
      api_key: "leak_me",
      workspaceId: "ws_other",
      password: "secret",
      role: "admin", // legitimate field, must keep
    });

    const [contact] = await rawDb`SELECT * FROM contacts WHERE workspace_id = ${wsId}` as any[];
    expect(contact.attributes.role).toBe("admin");
    expect(contact.attributes.api_key).toBeUndefined();
    expect(contact.attributes.password).toBeUndefined();
    expect(contact.attributes.workspaceId).toBeUndefined();
  });

  it("POST /cio/v1/customers/:id/events records an event", async () => {
    const { wsId, apiKey } = await makeWorkspaceWithApiKey();
    // First identify the contact
    await cioReq("PUT", "/cio/v1/customers/carol@example.com", apiKey, { name: "Carol" });
    // Then send an event
    const res = await cioReq("POST", "/cio/v1/customers/carol@example.com/events", apiKey, {
      name: "purchase_made",
      data: { amount: 99 },
    });
    expect(res.status).toBe(200);

    await Bun.sleep(500);
    const [event] = await rawDb`SELECT * FROM events WHERE workspace_id = ${wsId}` as any[];
    expect(event.name).toBe("purchase_made");
    expect(event.properties.amount).toBe(99);
  });

  it("DELETE /cio/v1/customers/:id hard-deletes contact (audit fix API-4)", async () => {
    const { wsId, apiKey } = await makeWorkspaceWithApiKey();
    await cioReq("PUT", "/cio/v1/customers/dave@example.com", apiKey, { name: "Dave" });

    const before = await rawDb`SELECT * FROM contacts WHERE workspace_id = ${wsId}` as any[];
    expect(before.length).toBe(1);

    const res = await cioReq("DELETE", "/cio/v1/customers/dave@example.com", apiKey);
    expect(res.status).toBe(200);

    const after = await rawDb`SELECT * FROM contacts WHERE workspace_id = ${wsId}` as any[];
    expect(after.length).toBe(0);
  });

  it("PUT /cio/v1/objects/:type/:id upserts a group", async () => {
    const { wsId, apiKey } = await makeWorkspaceWithApiKey();
    const res = await cioReq("PUT", "/cio/v1/objects/1/acme-corp", apiKey, {
      name: "Acme Corp",
      industry: "manufacturing",
    });
    expect(res.status).toBe(200);

    const [group] = await rawDb`SELECT * FROM groups WHERE workspace_id = ${wsId}` as any[];
    expect(group.group_type).toBe("company");
    expect(group.group_key).toBe("acme-corp");
    expect(group.attributes.name).toBe("Acme Corp");
    expect(group.attributes.industry).toBe("manufacturing");
  });

  it("PUT /cio/v1/objects/:type/:id/relationships links contacts to group", async () => {
    const { wsId, apiKey } = await makeWorkspaceWithApiKey();
    // Create a contact first
    await cioReq("PUT", "/cio/v1/customers/erin@example.com", apiKey, { name: "Erin" });
    // Create the group
    await cioReq("PUT", "/cio/v1/objects/1/acme", apiKey, { name: "Acme" });
    // Link
    const res = await cioReq("PUT", "/cio/v1/objects/1/acme/relationships", apiKey, {
      relationships: [{ identifiers: { email: "erin@example.com" } }],
    });
    expect(res.status).toBe(200);

    const [link] = await rawDb`
      SELECT cg.*, g.group_key
      FROM contact_groups cg
      JOIN groups g ON g.id = cg.group_id
      WHERE cg.workspace_id = ${wsId}` as any[];
    expect(link.group_key).toBe("acme");
  });

  it("rejects request with invalid Basic auth", async () => {
    const res = await app.request("/api/ingest/cio/v1/customers/x@example.com", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": basicAuthHeader("om_invalid_key"),
      },
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(401);
  });
});
