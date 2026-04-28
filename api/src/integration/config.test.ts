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
 *
 * Self-contained: this test only needs Postgres (for auth tables) — no Redis,
 * no BullMQ, no engine-specific fixtures. We boot an ephemeral Postgres in
 * Docker on a dedicated port to avoid colliding with other tests.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import postgres from "postgres";
import path from "path";

// ── Test infrastructure ─────────────────────────────────────────────────────

const TEST_PG_PORT = Number(process.env.OPENMAIL_TEST_PG_PORT ?? "5450");
const PG_CONTAINER = `openmail-cfgtest-pg-${process.env.OPENMAIL_TEST_SUFFIX ?? "default"}`;
const TEST_DB_URL = `postgresql://openmail:openmail_password@127.0.0.1:${TEST_PG_PORT}/openmail_test`;

process.env.DATABASE_URL = TEST_DB_URL;
process.env.BETTER_AUTH_SECRET = "config-test-secret-abc123xyz456def"; // pragma: allowlist secret
process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
process.env.WEB_URL = process.env.WEB_URL ?? "http://localhost:5173";
process.env.RESEND_API_KEY = "re_test_config"; // pragma: allowlist secret

async function spawn(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  return { code, stderr: await new Response(proc.stderr).text() };
}

async function startTestDb() {
  await spawn(["docker", "rm", "-f", PG_CONTAINER]);
  const r = await spawn([
    "docker", "run", "-d",
    "--name", PG_CONTAINER,
    "-e", "POSTGRES_DB=openmail_test",
    "-e", "POSTGRES_USER=openmail",
    "-e", "POSTGRES_PASSWORD=openmail_password",
    "-p", `${TEST_PG_PORT}:5432`,
    "postgres:16-alpine",
  ]);
  if (r.code !== 0) throw new Error(`Postgres start failed: ${r.stderr}`);
}

async function stopTestDb() {
  await spawn(["docker", "rm", "-f", PG_CONTAINER]);
}

async function waitForDb(maxRetries = 60): Promise<void> {
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
  throw new Error("Postgres did not become ready");
}

async function runMigrations(rawDb: postgres.Sql) {
  const dir = path.join(import.meta.dir, "../../../packages/shared/drizzle");
  const files = [
    "0000_woozy_sharon_ventura.sql",
    "0001_sending_domains.sql",
    "0002_assets.sql",
    "0003_workspace_logo.sql",
    "0004_shocking_slyde.sql",
  ];
  for (const file of files) {
    const sql = await Bun.file(path.join(dir, file)).text();
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await rawDb.unsafe(stmt);
    }
  }
}

// ── Test state ──────────────────────────────────────────────────────────────

let rawDb: postgres.Sql;
let app: any;

beforeAll(async () => {
  await startTestDb();
  await waitForDb();
  rawDb = postgres(TEST_DB_URL, { max: 5 });
  await runMigrations(rawDb);
  const mod = await import("../index.js");
  app = mod.app;
}, 180_000);

afterAll(async () => {
  await rawDb?.end({ timeout: 5 }).catch(() => {});
  await stopTestDb();
}, 30_000);

beforeEach(async () => {
  // CASCADE handles workspace_members, sessions, etc.
  await rawDb`TRUNCATE "user", workspaces RESTART IDENTITY CASCADE`;
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

describe("deployment config endpoint", () => {
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
    expect(JSON.stringify(body)).not.toMatch(/openmail\.win/);
  });
});
