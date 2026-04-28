/**
 * Deployment config endpoint contract test.
 *
 * Verifies:
 *   - Auth: returns 401 without session cookie
 *   - Defaults: returns SaaS defaults when env vars are absent
 *   - Override: respects MCP_PUBLIC_URL / DOCS_PUBLIC_URL / API_PUBLIC_URL
 *   - Shape: forward-compatible fields are present (mcp.authScheme, mcp.keysHref, version)
 *   - Stability: authScheme is the literal "bearer-api-key" — changing this
 *     value is an intentional breaking change for the dashboard.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import postgres from "postgres";
import {
  setTestEnv, startContainers, stopContainers, waitForDb, waitForRedis,
  runMigrations, cleanDb, flushRedis, TEST_DB_URL,
} from "./_fixtures.js";

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

// ── Helpers ────────────────────────────────────────────────────────────────

function cookieHeader(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=\s*[a-zA-Z0-9_-]+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function signUp() {
  const email = `cfg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.example.com`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "TestPassword123!", name: "Cfg Tester" }),
  });
  if (res.status !== 200) {
    throw new Error(`Sign-up failed (${res.status}): ${await res.text()}`);
  }
  return cookieHeader(res);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("deployment config endpoint (T-CFG)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await app.request("/api/session/config");
    expect(res.status).toBe(401);
  });

  it("returns SaaS defaults when env overrides are absent", async () => {
    // Save and clear env vars for this test
    const savedMcp = process.env.MCP_PUBLIC_URL;
    const savedDocs = process.env.DOCS_PUBLIC_URL;
    delete process.env.MCP_PUBLIC_URL;
    delete process.env.DOCS_PUBLIC_URL;

    try {
      const cookie = await signUp();
      const res = await app.request("/api/session/config", {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;

      expect(body.mcpUrl).toBe("https://mcp.openmail.win/mcp");
      expect(body.docsUrl).toBe("https://openmail.win/docs");
    } finally {
      if (savedMcp !== undefined) process.env.MCP_PUBLIC_URL = savedMcp;
      if (savedDocs !== undefined) process.env.DOCS_PUBLIC_URL = savedDocs;
    }
  });

  it("respects MCP_PUBLIC_URL and DOCS_PUBLIC_URL env overrides", async () => {
    const savedMcp = process.env.MCP_PUBLIC_URL;
    const savedDocs = process.env.DOCS_PUBLIC_URL;
    process.env.MCP_PUBLIC_URL = "https://mcp.example.com/mcp";
    process.env.DOCS_PUBLIC_URL = "https://docs.example.com";

    try {
      const cookie = await signUp();
      const res = await app.request("/api/session/config", {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;

      expect(body.mcpUrl).toBe("https://mcp.example.com/mcp");
      expect(body.docsUrl).toBe("https://docs.example.com");
    } finally {
      if (savedMcp !== undefined) process.env.MCP_PUBLIC_URL = savedMcp;
      else delete process.env.MCP_PUBLIC_URL;
      if (savedDocs !== undefined) process.env.DOCS_PUBLIC_URL = savedDocs;
      else delete process.env.DOCS_PUBLIC_URL;
    }
  });

  it("returns the forward-compatible shape with all required fields", async () => {
    const cookie = await signUp();
    const res = await app.request("/api/session/config", {
      headers: { Cookie: cookie },
    });
    const body = await res.json() as any;

    expect(typeof body.apiUrl).toBe("string");
    expect(typeof body.mcpUrl).toBe("string");
    expect(typeof body.docsUrl).toBe("string");
    expect(typeof body.version).toBe("string");
    expect(body.mcp).toBeDefined();
    expect(body.mcp.keysHref).toBe("/settings/api-keys");
  });

  it("authScheme is the literal 'bearer-api-key' (changing this is a breaking change)", async () => {
    const cookie = await signUp();
    const res = await app.request("/api/session/config", {
      headers: { Cookie: cookie },
    });
    const body = await res.json() as any;
    // This assertion is intentionally strict — if the value changes (e.g. to
    // "oauth-2.1"), the dashboard's setup UI must be updated in lockstep.
    expect(body.mcp.authScheme).toBe("bearer-api-key");
  });
});
