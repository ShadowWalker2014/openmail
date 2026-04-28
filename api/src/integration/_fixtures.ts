/**
 * Shared integration-test harness.
 *
 * Boots ephemeral Docker containers for Postgres (port 5434) and Redis
 * (port 6380), applies all Drizzle migrations + the runtime CREATE-IF-NOT-EXISTS
 * statements baked into api/src/index.ts (groups, segment_memberships, indexes).
 *
 * Used by:
 *   - campaign-engine.test.ts  (T11)
 *   - rate-limit.test.ts       (T12)
 *   - ingest-posthog.test.ts   (T13)
 *   - ingest-cio.test.ts       (T14)
 *
 * Pattern matches domains.integration.test.ts but adds Redis (required for
 * BullMQ queue ops and the new rate limiter).
 */

import postgres from "postgres";
import path from "path";

// Per-test-file isolation: each file gets a unique container suffix and ports
// derived from its filename, so multiple files can boot in parallel/sequence
// without collisions. Caller passes an explicit suffix via setTestEnv arguments.
//
// Distinct from domains.integration.test.ts (which uses 5433 / its own container).
const SUFFIX = process.env.OPENMAIL_TEST_SUFFIX ?? "default";
const PG_PORT = Number(process.env.OPENMAIL_TEST_PG_PORT ?? "5444");
const REDIS_PORT = Number(process.env.OPENMAIL_TEST_REDIS_PORT ?? "6390");

export const TEST_DB_URL = `postgresql://openmail:openmail_password@127.0.0.1:${PG_PORT}/openmail_test`;
export const TEST_REDIS_URL = `redis://127.0.0.1:${REDIS_PORT}`;

export const PG_CONTAINER = `openmail-itest-pg-${SUFFIX}`;
export const REDIS_CONTAINER = `openmail-itest-redis-${SUFFIX}`;

export function setTestEnv() {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.REDIS_URL = TEST_REDIS_URL;
  process.env.BETTER_AUTH_SECRET = "engine-test-secret-abc123xyz456def"; // pragma: allowlist secret
  process.env.BETTER_AUTH_URL = "http://localhost:3001";
  process.env.WEB_URL = "http://localhost:5173";
  process.env.DEFAULT_FROM_EMAIL = "noreply@openmail.dev";
  process.env.PLATFORM_FROM_EMAIL = "platform@openmail.dev";
  process.env.RESEND_API_KEY = "re_test_engine_integration"; // pragma: allowlist secret
}

async function spawn(cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function startContainers() {
  // Cleanup leftovers
  await spawn(["docker", "rm", "-f", PG_CONTAINER]);
  await spawn(["docker", "rm", "-f", REDIS_CONTAINER]);

  const pg = await spawn([
    "docker", "run", "-d",
    "--name", PG_CONTAINER,
    "-e", "POSTGRES_DB=openmail_test",
    "-e", "POSTGRES_USER=openmail",
    "-e", "POSTGRES_PASSWORD=openmail_password",
    "-p", `${PG_PORT}:5432`,
    "postgres:16-alpine",
  ]);
  if (pg.code !== 0) throw new Error(`Postgres start failed: ${pg.stderr}`);

  const redis = await spawn([
    "docker", "run", "-d",
    "--name", REDIS_CONTAINER,
    "-p", `${REDIS_PORT}:6379`,
    "redis:7-alpine",
  ]);
  if (redis.code !== 0) throw new Error(`Redis start failed: ${redis.stderr}`);
}

export async function stopContainers() {
  await spawn(["docker", "rm", "-f", PG_CONTAINER]);
  await spawn(["docker", "rm", "-f", REDIS_CONTAINER]);
}

export async function waitForDb(maxRetries = 60): Promise<void> {
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

export async function waitForRedis(maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const proc = Bun.spawn(["docker", "exec", REDIS_CONTAINER, "redis-cli", "PING"], { stdout: "pipe" });
      await proc.exited;
      const out = await new Response(proc.stdout).text();
      if (out.trim() === "PONG") return;
    } catch {
      // ignore
    }
    await Bun.sleep(500);
  }
  throw new Error("Redis did not become ready");
}

export async function runMigrations(rawDb: postgres.Sql) {
  const dir = path.join(import.meta.dir, "../../../packages/shared/drizzle");
  // Apply all migrations in order
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

  // Apply runtime CREATE-IF-NOT-EXISTS statements from api/src/index.ts
  // (groups, segment_memberships, indexes). Easiest: manually mirror them here.
  // Reason: api's runStartupMigrations is private. Keep in sync.
  const runtimeStatements = [
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS logo_url TEXT`,
    `CREATE TABLE IF NOT EXISTS groups (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      group_type   TEXT NOT NULL DEFAULT 'company',
      group_key    TEXT NOT NULL,
      attributes   JSONB DEFAULT '{}'::jsonb,
      created_at   TIMESTAMP NOT NULL DEFAULT now(),
      updated_at   TIMESTAMP NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS groups_workspace_type_key_idx ON groups (workspace_id, group_type, group_key)`,
    `CREATE INDEX IF NOT EXISTS groups_workspace_idx ON groups (workspace_id)`,
    `CREATE TABLE IF NOT EXISTS contact_groups (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      contact_id   TEXT NOT NULL REFERENCES contacts(id)  ON DELETE CASCADE,
      group_id     TEXT NOT NULL REFERENCES groups(id)    ON DELETE CASCADE,
      role         TEXT,
      created_at   TIMESTAMP NOT NULL DEFAULT now(),
      PRIMARY KEY (contact_id, group_id)
    )`,
    `CREATE TABLE IF NOT EXISTS segment_memberships (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      segment_id   TEXT NOT NULL REFERENCES segments(id)   ON DELETE CASCADE,
      contact_id   TEXT NOT NULL REFERENCES contacts(id)   ON DELETE CASCADE,
      created_at   TIMESTAMP NOT NULL DEFAULT now(),
      PRIMARY KEY (segment_id, contact_id)
    )`,
    `ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS bounce_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS complaint_count INTEGER NOT NULL DEFAULT 0`,
  ];
  for (const stmt of runtimeStatements) {
    await rawDb.unsafe(stmt);
  }
}

/**
 * Truncate all tables for a clean slate.
 * Order matters less because of CASCADE, but we list in dependency order.
 */
export async function cleanDb(rawDb: postgres.Sql) {
  await rawDb`TRUNCATE
    "user", workspaces, contacts, events, segments, segment_memberships,
    campaigns, campaign_steps, campaign_enrollments,
    email_templates, broadcasts, email_sends, email_events,
    api_keys, groups, contact_groups
    RESTART IDENTITY CASCADE`;
}

/** Flush Redis between tests (clears rate-limit buckets and queue state). */
export async function flushRedis() {
  await spawn(["docker", "exec", REDIS_CONTAINER, "redis-cli", "FLUSHALL"]);
}
