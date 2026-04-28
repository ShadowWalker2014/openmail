/**
 * Deployment config endpoint contract test.
 *
 * Verifies:
 *   - Auth: returns 401 without session cookie
 *   - SSOT chain: explicit override > BETTER_AUTH_URL/WEB_URL derivation > null
 *   - Subdomain convention derivation (api.X → mcp.X/mcp, app.X → docs.X)
 *   - Local-dev derivation (localhost → port-shifted MCP URL)
 *   - Path-fallback derivation for docs (bare host → host/docs)
 *   - Unconfigured case returns null (NOT a SaaS hardcode)
 *   - mcpUrlSource / docsUrlSource correctly tagged ("explicit"|"derived"|"unconfigured")
 *   - Forward-compat shape (mcp.authScheme, mcp.keysHref, version)
 *   - authScheme literal stability (changing this is a breaking change)
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

async function getConfigWith(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const cookie = await signUp();
    const res = await app.request("/api/session/config", { headers: { Cookie: cookie } });
    return { status: res.status, body: await res.json() as any };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("deployment config endpoint (T-CFG)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await app.request("/api/session/config");
    expect(res.status).toBe(401);
  });

  it("explicit MCP_PUBLIC_URL override wins over derivation", async () => {
    const { status, body } = await getConfigWith({
      MCP_PUBLIC_URL: "https://mcp.example.com/mcp",
      BETTER_AUTH_URL: "https://api.different.io",
    });
    expect(status).toBe(200);
    expect(body.mcpUrl).toBe("https://mcp.example.com/mcp");
    expect(body.mcpUrlSource).toBe("explicit");
  });

  it("derives MCP URL from api.<base> subdomain convention", async () => {
    const { body } = await getConfigWith({
      MCP_PUBLIC_URL: undefined,
      BETTER_AUTH_URL: "https://api.acme.io",
    });
    expect(body.mcpUrl).toBe("https://mcp.acme.io/mcp");
    expect(body.mcpUrlSource).toBe("derived");
  });

  it("derives MCP URL from localhost (port-shifted)", async () => {
    const { body } = await getConfigWith({
      MCP_PUBLIC_URL: undefined,
      MCP_PORT: undefined,
      BETTER_AUTH_URL: "http://localhost:3001",
    });
    expect(body.mcpUrl).toBe("http://localhost:3002/mcp");
    expect(body.mcpUrlSource).toBe("derived");
  });

  it("respects MCP_PORT for local-dev derivation", async () => {
    const { body } = await getConfigWith({
      MCP_PUBLIC_URL: undefined,
      MCP_PORT: "3402",
      BETTER_AUTH_URL: "http://localhost:3401",
    });
    expect(body.mcpUrl).toBe("http://localhost:3402/mcp");
    expect(body.mcpUrlSource).toBe("derived");
  });

  it("returns null for MCP when neither override nor convention applies", async () => {
    // Bare host (no api. prefix, not localhost) → cannot guess MCP host
    const { body } = await getConfigWith({
      MCP_PUBLIC_URL: undefined,
      BETTER_AUTH_URL: "https://acme.io",
    });
    expect(body.mcpUrl).toBeNull();
    expect(body.mcpUrlSource).toBe("unconfigured");
  });

  it("returns null for MCP when BETTER_AUTH_URL is missing entirely", async () => {
    const { body } = await getConfigWith({
      MCP_PUBLIC_URL: undefined,
      BETTER_AUTH_URL: undefined,
    });
    expect(body.mcpUrl).toBeNull();
    expect(body.mcpUrlSource).toBe("unconfigured");
  });

  it("explicit DOCS_PUBLIC_URL override wins over derivation", async () => {
    const { body } = await getConfigWith({
      DOCS_PUBLIC_URL: "https://docs.example.com",
      WEB_URL: "https://app.different.io",
    });
    expect(body.docsUrl).toBe("https://docs.example.com");
    expect(body.docsUrlSource).toBe("explicit");
  });

  it("derives docs URL from app.<base> subdomain convention", async () => {
    const { body } = await getConfigWith({
      DOCS_PUBLIC_URL: undefined,
      WEB_URL: "https://app.acme.io",
    });
    expect(body.docsUrl).toBe("https://docs.acme.io");
    expect(body.docsUrlSource).toBe("derived");
  });

  it("derives docs URL on bare host as <host>/docs", async () => {
    const { body } = await getConfigWith({
      DOCS_PUBLIC_URL: undefined,
      WEB_URL: "https://acme.io",
    });
    expect(body.docsUrl).toBe("https://acme.io/docs");
    expect(body.docsUrlSource).toBe("derived");
  });

  it("returns null for docs when WEB_URL is missing entirely", async () => {
    const { body } = await getConfigWith({
      DOCS_PUBLIC_URL: undefined,
      WEB_URL: undefined,
    });
    expect(body.docsUrl).toBeNull();
    expect(body.docsUrlSource).toBe("unconfigured");
  });

  it("returns the forward-compatible shape with all required fields", async () => {
    const { body } = await getConfigWith({});
    expect(typeof body.apiUrl).toBe("string");
    // mcpUrl/docsUrl can be null (unconfigured) or string — both valid.
    expect(body.mcpUrl === null || typeof body.mcpUrl === "string").toBe(true);
    expect(body.docsUrl === null || typeof body.docsUrl === "string").toBe(true);
    expect(["explicit", "derived", "unconfigured"]).toContain(body.mcpUrlSource);
    expect(["explicit", "derived", "unconfigured"]).toContain(body.docsUrlSource);
    expect(typeof body.version).toBe("string");
    expect(body.mcp).toBeDefined();
    expect(body.mcp.keysHref).toBe("/settings/api-keys");
  });

  it("authScheme is the literal 'bearer-api-key' (changing this is a breaking change)", async () => {
    const { body } = await getConfigWith({});
    // Strict — if the value changes (e.g. to "oauth-2.1"), the dashboard's
    // setup UI must be updated in lockstep.
    expect(body.mcp.authScheme).toBe("bearer-api-key");
  });

  it("does NOT fall back to upstream SaaS hosts when unconfigured", async () => {
    // Regression guard: previously the endpoint returned mcp.openmail.win as
    // a default when env was unset. That silently misconfigures self-hosters.
    const { body } = await getConfigWith({
      MCP_PUBLIC_URL: undefined,
      DOCS_PUBLIC_URL: undefined,
      BETTER_AUTH_URL: "https://acme.io",   // bare → cannot derive MCP
      WEB_URL: undefined,                   // missing → cannot derive docs
    });
    expect(body.mcpUrl).toBeNull();
    expect(body.docsUrl).toBeNull();
    // Regression guard: ensure the response body itself contains no openmail.win literal
    expect(JSON.stringify(body)).not.toMatch(/openmail\.win/);
  });
});
