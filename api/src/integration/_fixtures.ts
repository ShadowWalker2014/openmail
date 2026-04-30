/**
 * Shared fixtures for the Stage 1 integration test suite (T11–T14).
 *
 * Strategy mirrors `domains.integration.test.ts`:
 *   ✓ Real PostgreSQL — Docker container, dedicated to integration tests
 *   ✓ Real Redis      — Docker container, ditto
 *   ✓ Real Hono app   — in-process via app.request()
 *   ✓ Real Drizzle    — actual queries against the real schema
 *   ✓ Real BullMQ     — workers run in-process when needed (T11)
 *   ~ Resend HTTP     — intercepted at the global fetch level so the SDK
 *                       request/response code paths still execute
 *
 * Test database/redis are reused across files (started ONCE by the operator —
 * `docker compose up postgres pgbouncer redis` or the helper script).
 *
 * The fixtures DO NOT spawn a docker container themselves; we expect the
 * containers to already be running on TEST_DATABASE_URL / TEST_REDIS_URL.
 * This way running `bun test src/integration/` in parallel does not
 * clobber any single shared container.
 */
import postgres from "postgres";
import path from "path";
import { createHash } from "crypto";
import { generateId } from "@openmail/shared/ids";

// ── Test infrastructure URLs ─────────────────────────────────────────────────
// Defaults match the pre-started container the orchestrator spun up.
// Override via env vars if running against docker-compose (5432 / 6379).
export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://openmail:openmail_password@127.0.0.1:5455/openmail_test";

export const TEST_REDIS_URL =
  process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6395";

// ── Process env for the api/worker (must be set before any lazy-init) ────────
// Callers should `import "./_fixtures.ts"` BEFORE importing any api/* module.
process.env.DATABASE_URL = TEST_DB_URL;
process.env.REDIS_URL = TEST_REDIS_URL;
process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-abc123xyz456def"; // pragma: allowlist secret
process.env.BETTER_AUTH_URL ??= "http://localhost:3001"; // pragma: allowlist secret
process.env.WEB_URL ??= "http://localhost:5173";
process.env.DEFAULT_FROM_EMAIL ??= "noreply@openmail.dev";
// Resend SDK requires *some* key to be set at constructor time; the actual
// HTTP call is intercepted by the fetch wrapper below.
process.env.RESEND_API_KEY ??= "re_test_integration_fake_key";
process.env.TRACKER_URL ??= "http://localhost:3002";
// Disable bull-board basic-auth (off by default) so it doesn't try to bind.
delete process.env.BULL_BOARD_PASSWORD;
// Tame the rate-limit window for fast tests where we want to observe expiry.
process.env.RATE_LIMIT_WINDOW_SECONDS ??= "60";
process.env.RATE_LIMIT_DEFAULT_PER_WINDOW ??= "1000";

// ── Resend HTTP interceptor (pattern from domains.integration.test.ts) ───────
// Each test file may set its own scenario via setResendScenario().
export interface ResendScenario {
  status: number;
  body: object;
}

let resendScenario: ResendScenario | null = null;

export function setResendScenario(scenario: ResendScenario | null): void {
  resendScenario = scenario;
}

// Default success scenario for /emails endpoint.
export const RESEND_SEND_OK: ResendScenario = {
  status: 200,
  body: { id: "rs_msg_test_integration", from: "noreply@openmail.dev", to: ["test@test.com"] },
};

// Permanent failure (bad address) — Resend returns 4xx.
export const RESEND_SEND_BAD_ADDRESS: ResendScenario = {
  status: 422,
  body: { name: "validation_error", message: "Invalid `to` address" },
};

const realFetch = globalThis.fetch;
let interceptorInstalled = false;

function installFetchInterceptor() {
  if (interceptorInstalled) return;
  interceptorInstalled = true;
  (globalThis as any).fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input.toString();
    if (url.startsWith("https://api.resend.com/")) {
      const scenario = resendScenario ?? RESEND_SEND_OK;
      return new Response(JSON.stringify(scenario.body), {
        status: scenario.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return realFetch(input, init);
  };
}
installFetchInterceptor();

// ── DB lifecycle ─────────────────────────────────────────────────────────────

let _rawDb: postgres.Sql | null = null;

export function getRawDb(): postgres.Sql {
  if (!_rawDb) _rawDb = postgres(TEST_DB_URL, { max: 5, prepare: false });
  return _rawDb;
}

export async function closeRawDb(): Promise<void> {
  if (_rawDb) {
    await _rawDb.end({ timeout: 5 }).catch(() => {});
    _rawDb = null;
  }
}

export async function waitForDb(maxRetries = 40): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    const pg = postgres(TEST_DB_URL, { max: 1, connect_timeout: 2, idle_timeout: 1, prepare: false });
    try {
      await pg`SELECT 1`;
      await pg.end();
      return;
    } catch {
      await pg.end({ timeout: 1 }).catch(() => {});
      // Polling-with-timeout pattern is fine; this is infra readiness, not
      // app-level waiting. Plan CN-01 only forbids setTimeout for *engine*
      // wait steps.
      await Bun.sleep(500);
    }
  }
  throw new Error(`Database not ready at ${TEST_DB_URL} after ${maxRetries} retries`);
}

export async function runMigrations(): Promise<void> {
  const db = getRawDb();
  const dir = path.join(import.meta.dir, "../../../packages/shared/drizzle");
  const files = [
    "0000_woozy_sharon_ventura.sql",
    "0001_sending_domains.sql",
    "0002_assets.sql",
    "0003_workspace_logo.sql",
    "0004_shocking_slyde.sql",
    // Stage 2 — additive lifecycle columns + enrollment_events table.
    "0005_lifecycle_engine.sql",
    "0006_enrollment_events.sql",
    // Stage 2 R5 — audit chokepoint trigger (campaigns-only). Protects
    // PATCH-alias drift while leaving the enrollment-level engine paths
    // (Stage 1 step-advance.ts) untouched. See migration header for scope
    // rationale and Stage 3 follow-up.
    "0007_audit_chokepoint_trigger.sql",
    // Stage 3 — workspace lifecycle settings (resume defaults).
    "0008_workspace_lifecycle_settings.sql",
    // Stage 4 — per-step pause schema + event-type CHECK extension.
    "0009_step_pause.sql",
    "0010_event_types_step_pause.sql",
    // Stage 5 — campaign goals table + event types extension.
    "0011_campaign_goals.sql",
    "0012_event_types_goals.sql",
    // Stage 6 — archive table, edit outbox, extended event_type CHECK.
    "0013_archive_outbox.sql",
  ];
  for (const file of files) {
    const sql = await Bun.file(path.join(dir, file)).text();
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await db.unsafe(stmt).catch((err: Error) => {
        // Ignore "already exists" — migrations are idempotent across test files.
        if (!/already exists|duplicate/i.test(err.message)) throw err;
      });
    }
  }
  // Mirror api/src/index.ts:runStartupMigrations() — runtime DDL the api
  // expects to be in place before serving requests.
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS groups (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      group_type   TEXT NOT NULL DEFAULT 'company',
      group_key    TEXT NOT NULL,
      attributes   JSONB DEFAULT '{}'::jsonb,
      created_at   TIMESTAMP NOT NULL DEFAULT now(),
      updated_at   TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await db.unsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS groups_workspace_type_key_idx ON groups (workspace_id, group_type, group_key)`,
  );
  await db.unsafe(`CREATE INDEX IF NOT EXISTS groups_workspace_idx ON groups (workspace_id)`);
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS contact_groups (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      contact_id   TEXT NOT NULL REFERENCES contacts(id)  ON DELETE CASCADE,
      group_id     TEXT NOT NULL REFERENCES groups(id)    ON DELETE CASCADE,
      role         TEXT,
      created_at   TIMESTAMP NOT NULL DEFAULT now(),
      PRIMARY KEY (contact_id, group_id)
    )
  `);
  await db.unsafe(
    `CREATE TABLE IF NOT EXISTS segment_memberships (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      segment_id   TEXT NOT NULL REFERENCES segments(id)   ON DELETE CASCADE,
      contact_id   TEXT NOT NULL REFERENCES contacts(id)   ON DELETE CASCADE,
      created_at   TIMESTAMP NOT NULL DEFAULT now(),
      PRIMARY KEY (segment_id, contact_id)
    )`,
  );
}

/**
 * TRUNCATE every domain table to a clean slate. CASCADE handles all FKs.
 * Safe between tests.
 */
export async function cleanDb(): Promise<void> {
  const db = getRawDb();
  await db.unsafe(`
    TRUNCATE
      "user", workspaces, contacts, events, campaigns, campaign_steps,
      campaign_enrollments, email_sends, email_events, email_templates,
      broadcasts, segments, api_keys, groups, contact_groups, segment_memberships,
      enrollment_events, workspace_lifecycle_settings, campaign_goals
    RESTART IDENTITY CASCADE
  `).catch(() => {
    // Some tables may not exist in older schema during initial migration runs.
  });
}

// ── Redis helper ─────────────────────────────────────────────────────────────

export async function flushRedis(): Promise<void> {
  // Use ioredis (already a transitive dep via bullmq) for FLUSHDB.
  const Redis = (await import("ioredis")).default;
  const parsed = new URL(TEST_REDIS_URL);
  const client = new Redis({
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });
  try {
    await client.flushdb();
  } finally {
    await client.quit().catch(() => {});
  }
}

// ── Domain fixtures ──────────────────────────────────────────────────────────

/**
 * Direct DB insert: workspace + member + api key. Skips Better Auth so tests
 * don't depend on the auth flow when they only need workspace context.
 *
 * Returns the raw API key (caller should send via `Authorization: Bearer ...`)
 * and the workspace id.
 */
export async function createWorkspaceWithApiKey(opts: {
  workspaceName?: string;
  apiKeyName?: string;
} = {}): Promise<{ workspaceId: string; apiKey: string; apiKeyId: string }> {
  const db = getRawDb();
  const workspaceId = generateId("ws");
  const slug = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db`
    INSERT INTO workspaces (id, name, slug, plan)
    VALUES (${workspaceId}, ${opts.workspaceName ?? "Test Workspace"}, ${slug}, 'free')
  `;

  // The raw key is what the customer pastes in their SDK; we store its
  // sha256 hash. Mirrors api-keys route logic.
  const apiKey = `om_test_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  const apiKeyId = generateId("key");
  await db`
    INSERT INTO api_keys (id, workspace_id, name, key_hash, key_prefix)
    VALUES (${apiKeyId}, ${workspaceId}, ${opts.apiKeyName ?? "test"}, ${keyHash}, ${apiKey.slice(0, 12)})
  `;

  return { workspaceId, apiKey, apiKeyId };
}

/** Insert a contact and return its id. */
export async function createContact(
  workspaceId: string,
  email: string,
  attrs: { firstName?: string; lastName?: string; unsubscribed?: boolean } = {},
): Promise<string> {
  const db = getRawDb();
  const contactId = generateId("con");
  await db`
    INSERT INTO contacts (id, workspace_id, email, first_name, last_name, unsubscribed)
    VALUES (
      ${contactId},
      ${workspaceId},
      ${email},
      ${attrs.firstName ?? null},
      ${attrs.lastName ?? null},
      ${attrs.unsubscribed ?? false}
    )
  `;
  return contactId;
}

/** Insert an email_templates row and return id. */
export async function createTemplate(
  workspaceId: string,
  htmlContent: string,
  name = "Test Template",
): Promise<string> {
  const db = getRawDb();
  const tplId = generateId("tpl");
  await db`
    INSERT INTO email_templates (id, workspace_id, name, subject, html_content)
    VALUES (${tplId}, ${workspaceId}, ${name}, 'Test Subject', ${htmlContent})
  `;
  return tplId;
}

/**
 * Build a campaign with steps. Each spec is `{ stepType, config }`. The step
 * `position` is auto-assigned as the index in the array.
 *
 * Returns campaign id + steps[id, position] in order.
 */
export async function createCampaignWithSteps(
  workspaceId: string,
  opts: {
    name?: string;
    triggerType?: "event" | "segment_enter" | "segment_exit" | "manual";
    triggerConfig?: Record<string, unknown>;
    status?: "draft" | "active" | "paused" | "archived";
    steps: Array<{ stepType: "email" | "wait"; config: Record<string, unknown> }>;
  },
): Promise<{
  campaignId: string;
  steps: Array<{ id: string; position: number; stepType: string }>;
}> {
  const db = getRawDb();
  const campaignId = generateId("cmp");
  const triggerType = opts.triggerType ?? "event";
  const triggerConfig = opts.triggerConfig ?? { eventName: "test_event" };
  await db`
    INSERT INTO campaigns (id, workspace_id, name, status, trigger_type, trigger_config)
    VALUES (
      ${campaignId},
      ${workspaceId},
      ${opts.name ?? "Test Campaign"},
      ${opts.status ?? "active"},
      ${triggerType},
      ${db.json(triggerConfig as never)}
    )
  `;

  const steps: Array<{ id: string; position: number; stepType: string }> = [];
  for (let i = 0; i < opts.steps.length; i++) {
    const spec = opts.steps[i];
    const id = generateId("stp");
    await db`
      INSERT INTO campaign_steps (id, campaign_id, workspace_id, step_type, config, position)
      VALUES (
        ${id},
        ${campaignId},
        ${workspaceId},
        ${spec.stepType},
        ${db.json(spec.config as never)},
        ${i}
      )
    `;
    steps.push({ id, position: i, stepType: spec.stepType });
  }
  return { campaignId, steps };
}

// ── Polling-with-timeout helper (CN-01-safe wait pattern) ────────────────────

/**
 * Polls `predicate` every `pollMs` until it returns true or `timeoutMs` elapses.
 * Throws on timeout. Use this instead of setTimeout-and-hope.
 *
 * The `Bun.sleep` here is a polling tick, not an engine-level wait — fully
 * compatible with CN-01 (which forbids setTimeout for campaign wait steps,
 * not for test-level state polling).
 */
export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  opts: { timeoutMs?: number; pollMs?: number; description?: string } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const pollMs = opts.pollMs ?? 50;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await Bun.sleep(pollMs);
  }
  throw new Error(
    `waitFor timeout after ${timeoutMs}ms: ${opts.description ?? "predicate did not become true"}`,
  );
}
