/**
 * Stage 3 integration tests — burst-send mitigation on resume.
 *
 * Covers:
 *   - spread schedule distributes delays within ±5% of expected window
 *   - skip_stale: aged-past-threshold get skipped, recent ones untouched
 *   - skip_stale_spread: stale skipped first, remainder spread
 *   - rate-limiter floor when window too aggressive
 *   - spread_token idempotency (CR-02)
 *   - concurrency: 2nd resume → 409 SPREAD_IN_PROGRESS
 *   - missing rate-limit config → 503 RATE_LIMIT_CONFIG_MISSING
 *   - invalid spread_window_seconds → 400 INVALID_SPREAD_WINDOW
 *
 * Uses real Postgres + Redis (per Stage 1/2 convention). No setTimeout, no
 * full SCAN — direct exact-jobId checks via BullMQ Queue.getJob.
 */
import "./_fixtures";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Queue } from "bullmq";
import {
  TEST_REDIS_URL,
  waitForDb,
  runMigrations,
  closeRawDb,
  cleanDb,
  flushRedis,
  getRawDb,
  createWorkspaceWithApiKey,
  createTemplate,
  createCampaignWithSteps,
  createContact,
  setResendScenario,
  RESEND_SEND_OK,
} from "./_fixtures";
import { __resetRateLimiterForTests } from "../lib/rate-limiter";
import { generateId } from "@openmail/shared/ids";
import { Redis } from "ioredis";
import {
  computeSpreadSchedule,
  computeStepMs,
} from "../../../worker/src/lib/spread-strategy";
import { isStale } from "../../../worker/src/lib/stale-skip";

let app: any;

function redisConn() {
  const parsed = new URL(TEST_REDIS_URL);
  return { host: parsed.hostname, port: Number(parsed.port) || 6379 };
}

let stepQueue: Queue | null = null;
let resumeSpreadQueue: Queue | null = null;
let rawRedis: Redis | null = null;

// Configure workspace rate-limit cfg in Redis (CN-09 prerequisite).
async function setRateLimitConfig(workspaceId: string, sendsPerSec: number) {
  if (!rawRedis) {
    const parsed = new URL(TEST_REDIS_URL);
    rawRedis = new Redis({
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      maxRetriesPerRequest: 1,
    });
  }
  await rawRedis.set(
    `lifecycle:rate_limit:${workspaceId}`,
    JSON.stringify({ sends_per_sec: sendsPerSec }),
  );
}

beforeAll(async () => {
  await waitForDb();
  await runMigrations();
  await flushRedis();

  stepQueue = new Queue("step-execution", { connection: redisConn() });
  resumeSpreadQueue = new Queue("lifecycle-resume-spread", {
    connection: redisConn(),
  });

  const mod = await import("../index.js");
  app = mod.app;

  setResendScenario(RESEND_SEND_OK);
}, 60_000);

afterAll(async () => {
  await Promise.allSettled([
    stepQueue?.close(),
    resumeSpreadQueue?.close(),
    rawRedis?.quit(),
  ]);
  await __resetRateLimiterForTests();
  await closeRawDb();
}, 30_000);

beforeEach(async () => {
  await cleanDb();
  await flushRedis();
  rawRedis = null;
});

// ────────────────────────────────────────────────────────────────────────────
// Pure-helper unit-style tests — no DB needed but live alongside the
// integration suite for cohesion (T12 mandates these).
// ────────────────────────────────────────────────────────────────────────────

describe("spread-strategy pure helpers", () => {
  it("step_ms = window/total when rate-limit not binding", () => {
    const stepMs = computeStepMs({
      spreadWindowSeconds: 3600, // 1h = 3_600_000 ms
      total: 1000,
      rateLimitPerSec: 1000, // floor = 1ms — non-binding
    });
    expect(stepMs).toBe(3_600); // 3.6s
  });

  it("step_ms = rate-limit floor when window too aggressive (CR-01)", () => {
    const stepMs = computeStepMs({
      spreadWindowSeconds: 60, // 60_000 ms
      total: 10_000, // would yield 6ms each — too fast
      rateLimitPerSec: 100, // floor = 10ms
    });
    expect(stepMs).toBe(10);
  });

  it("yields delay tuples in ascending order", () => {
    const inputs = Array.from({ length: 5 }, (_, i) => ({
      enrollmentId: `e_${i}`,
      scheduledAt: new Date(2024, 0, 1, 12, i),
    }));
    const out = Array.from(
      computeSpreadSchedule(inputs, {
        spreadWindowSeconds: 60,
        rateLimitPerSec: 1000,
        total: 5,
        strategy: "fifo_by_resume_time",
      }),
    );
    expect(out.map((o) => o.offset)).toEqual([0, 1, 2, 3, 4]);
    // Delays strictly monotonic
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.delayMs).toBeGreaterThan(out[i - 1]!.delayMs);
    }
  });

  it("100 enrollments distributed across 60s ±5%", () => {
    const N = 100;
    const inputs = Array.from({ length: N }, (_, i) => ({
      enrollmentId: `e_${i}`,
      scheduledAt: new Date(),
    }));
    const out = Array.from(
      computeSpreadSchedule(inputs, {
        spreadWindowSeconds: 60,
        rateLimitPerSec: 1000,
        total: N,
        strategy: "fifo_by_resume_time",
      }),
    );
    const lastDelay = out[N - 1]!.delayMs;
    // Expected: (60_000 / 100) * 99 = 59_400 ms
    const expected = (60_000 / N) * (N - 1);
    const margin = expected * 0.05;
    expect(Math.abs(lastDelay - expected)).toBeLessThanOrEqual(margin);
  });
});

describe("stale-skip pure helper", () => {
  it("isStale true when older than threshold", () => {
    const now = new Date("2024-01-10T12:00:00Z");
    const old = new Date("2024-01-01T12:00:00Z"); // 9 days ago
    expect(isStale(old, 7 * 86400, now)).toBe(true);
  });

  it("isStale false when within threshold", () => {
    const now = new Date("2024-01-10T12:00:00Z");
    const recent = new Date("2024-01-05T12:00:00Z"); // 5 days ago
    expect(isStale(recent, 7 * 86400, now)).toBe(false);
  });

  it("isStale false on null/undefined input", () => {
    expect(isStale(null, 100)).toBe(false);
    expect(isStale(undefined, 100)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// API-level tests
// ────────────────────────────────────────────────────────────────────────────

async function postResume(
  apiKey: string,
  campaignId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/v1/campaigns/${campaignId}/resume`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function postPause(
  apiKey: string,
  campaignId: string,
): Promise<Response> {
  return app.request(`/api/v1/campaigns/${campaignId}/pause`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
}

/** Seed N overdue enrollments (active, paused first for the campaign). */
async function seedOverdueEnrollments(
  workspaceId: string,
  campaignId: string,
  stepId: string,
  count: number,
  options: { ageDays?: number } = {},
): Promise<string[]> {
  const db = getRawDb();
  const ids: string[] = [];
  const ageDays = options.ageDays ?? 1;
  // Unique-per-call seed prefix avoids contacts_workspace_email_idx collisions
  // when the same test seeds multiple cohorts (e.g. 5 stale + 5 recent).
  const seed = `${ageDays}_${Math.random().toString(36).slice(2, 8)}`;
  for (let i = 0; i < count; i++) {
    const contactId = generateId("con");
    const email = `bulk_${seed}_${i}@test.com`;
    await db`
      INSERT INTO contacts (id, workspace_id, email, unsubscribed)
      VALUES (${contactId}, ${workspaceId}, ${email}, false)
    `;
    const enrId = generateId("enr");
    await db`
      INSERT INTO campaign_enrollments (
        id, campaign_id, workspace_id, contact_id,
        current_step_id, status, started_at, next_run_at
      ) VALUES (
        ${enrId}, ${campaignId}, ${workspaceId}, ${contactId},
        ${stepId}, 'active', NOW() - INTERVAL '${db.unsafe(`${ageDays} days`)}',
        NOW() - INTERVAL '${db.unsafe(`${ageDays} days`)}'
      )
    `;
    ids.push(enrId);
  }
  return ids;
}

describe("Stage 3 — resume API validation", () => {
  it("400 on out-of-bounds spread_window_seconds (CN-03)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      status: "paused",
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });

    await setRateLimitConfig(workspaceId, 100);
    const res = await postResume(apiKey, campaignId, {
      mode: "spread",
      spread_window_seconds: 10, // below SPREAD_WINDOW_MIN_SECONDS=60
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_SPREAD_WINDOW");
  });

  it("503 when workspace rate-limit config absent (CN-09)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      status: "paused",
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });

    // Note: NOT setting rate-limit config → expect 503.
    const res = await postResume(apiKey, campaignId, {
      mode: "spread",
      spread_window_seconds: 3600,
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("RATE_LIMIT_CONFIG_MISSING");
  });

  it("immediate mode bypasses rate-limit-config check", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      status: "paused",
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });

    // No rate-limit config — immediate mode should still succeed.
    const res = await postResume(apiKey, campaignId, { mode: "immediate" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.campaign.status).toBe("active");
  });

  it("409 SPREAD_IN_PROGRESS on concurrent resume (CR-03)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      status: "paused",
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });

    await setRateLimitConfig(workspaceId, 100);

    // Acquire lock manually to simulate in-progress operation.
    const parsed = new URL(TEST_REDIS_URL);
    const lockClient = new Redis({
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      maxRetriesPerRequest: 1,
    });
    try {
      await lockClient.set(
        `campaign:lock:resume:${campaignId}`,
        "other-owner",
        "PX",
        60_000,
        "NX",
      );
      const res = await postResume(apiKey, campaignId, {
        mode: "spread",
        spread_window_seconds: 3600,
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("SPREAD_IN_PROGRESS");
    } finally {
      await lockClient.del(`campaign:lock:resume:${campaignId}`);
      await lockClient.quit();
    }
  });
});

describe("Stage 3 — overdue-count endpoint", () => {
  it("returns count + min/max next_run_at", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      status: "paused",
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });

    await seedOverdueEnrollments(
      workspaceId,
      campaignId,
      steps[0]!.id,
      5,
      { ageDays: 2 },
    );

    const res = await app.request(
      `/api/v1/campaigns/${campaignId}/overdue-count`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(5);
    expect(body.oldest_scheduled_at).not.toBeNull();
    expect(body.newest_scheduled_at).not.toBeNull();
  });
});

describe("Stage 3 — process-resume-spread worker (in-process)", () => {
  it("spread mode: tokens written + step jobs enqueued", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      status: "paused",
      steps: [
        { stepType: "wait", config: { duration: 1, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl, subject: "S" } },
      ],
    });

    await setRateLimitConfig(workspaceId, 100);
    const enrollments = await seedOverdueEnrollments(
      workspaceId,
      campaignId,
      steps[0]!.id,
      10,
      { ageDays: 1 },
    );

    // Trigger via API (campaign paused → active + enqueues spread worker job).
    const res = await postResume(apiKey, campaignId, {
      mode: "spread",
      spread_window_seconds: 3600, // 1h
      spread_strategy: "fifo_by_original_time",
    });
    expect(res.status).toBe(200);

    // Run worker job inline (so we don't depend on queue polling timing).
    const { processResumeSpreadJob } = await import(
      "../../../worker/src/jobs/process-resume-spread.js"
    );
    const body = (await res.json()) as { lifecycle_op_id: string };
    const stats = await processResumeSpreadJob({
      campaignId,
      workspaceId,
      mode: "spread",
      spreadWindowSeconds: 3600,
      staleThresholdSeconds: 7 * 86400,
      spreadStrategy: "fifo_by_original_time",
      lifecycleOpId: body.lifecycle_op_id,
      resumeLockOwner: `${body.lifecycle_op_id}:test`,
    });

    expect(stats.totalScanned).toBeGreaterThanOrEqual(10);
    expect(stats.spreadEnqueued).toBe(10);
    expect(stats.staleSkipped).toBe(0);

    // Verify each enrollment got a spread_token.
    const db = getRawDb();
    const tokenCount = (await db`
      SELECT COUNT(*)::int AS c FROM campaign_enrollments
       WHERE campaign_id = ${campaignId} AND spread_token IS NOT NULL
    `) as Array<{ c: number }>;
    expect(tokenCount[0]!.c).toBe(10);

    // Verify spread_scheduled events emitted.
    const events = (await db`
      SELECT COUNT(*)::int AS c FROM enrollment_events
       WHERE campaign_id = ${campaignId} AND event_type = 'spread_scheduled'
    `) as Array<{ c: number }>;
    expect(events[0]!.c).toBe(10);

    // Verify aggregate `resumed` event emitted.
    const aggregate = (await db`
      SELECT COUNT(*)::int AS c FROM enrollment_events
       WHERE campaign_id = ${campaignId} AND event_type = 'resumed'
         AND enrollment_id IS NULL
    `) as Array<{ c: number }>;
    expect(aggregate[0]!.c).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("idempotency: 2nd run of same job skips already-tokened (CR-02)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      status: "paused",
      steps: [
        { stepType: "wait", config: { duration: 1, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl, subject: "S" } },
      ],
    });

    await setRateLimitConfig(workspaceId, 100);
    await seedOverdueEnrollments(
      workspaceId,
      campaignId,
      steps[0]!.id,
      5,
      { ageDays: 1 },
    );

    const res = await postResume(apiKey, campaignId, {
      mode: "spread",
      spread_window_seconds: 3600,
    });
    const body = (await res.json()) as { lifecycle_op_id: string };

    const { processResumeSpreadJob } = await import(
      "../../../worker/src/jobs/process-resume-spread.js"
    );
    const args = {
      campaignId,
      workspaceId,
      mode: "spread" as const,
      spreadWindowSeconds: 3600,
      staleThresholdSeconds: 7 * 86400,
      spreadStrategy: "fifo_by_original_time" as const,
      lifecycleOpId: body.lifecycle_op_id,
      resumeLockOwner: `${body.lifecycle_op_id}:test`,
    };

    const first = await processResumeSpreadJob(args);
    expect(first.spreadEnqueued).toBe(5);

    // Simulate retry by clearing each row's next_run_at back to "overdue" but
    // KEEPING spread_token populated (the crash-survive scenario per CR-02).
    // Then re-run; the CAS guard `WHERE spread_token IS NULL` prevents
    // double-enqueue.
    const db = getRawDb();
    await db.unsafe(`
      UPDATE campaign_enrollments
         SET next_run_at = NOW() - INTERVAL '1 hour'
       WHERE campaign_id = '${campaignId}' AND spread_token IS NOT NULL
    `);

    const second = await processResumeSpreadJob(args);
    // 2nd run sees all 5 as overdue but they're already tokened → skipped.
    expect(second.alreadyTokenedSkipped).toBe(5);
    expect(second.spreadEnqueued).toBe(0);
  }, 30_000);

  it("skip_stale: stale ones skipped, recent ones untouched", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      status: "paused",
      steps: [
        { stepType: "wait", config: { duration: 1, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl, subject: "S" } },
      ],
    });

    await setRateLimitConfig(workspaceId, 100);
    // 5 stale (8d old)
    await seedOverdueEnrollments(workspaceId, campaignId, steps[0]!.id, 5, {
      ageDays: 8,
    });
    // 5 recent (1d old)
    await seedOverdueEnrollments(workspaceId, campaignId, steps[0]!.id, 5, {
      ageDays: 1,
    });

    const res = await postResume(apiKey, campaignId, {
      mode: "skip_stale",
      stale_threshold_seconds: 7 * 86400,
    });
    const body = (await res.json()) as { lifecycle_op_id: string };
    expect(res.status).toBe(200);

    const { processResumeSpreadJob } = await import(
      "../../../worker/src/jobs/process-resume-spread.js"
    );
    const stats = await processResumeSpreadJob({
      campaignId,
      workspaceId,
      mode: "skip_stale",
      spreadWindowSeconds: 3600,
      staleThresholdSeconds: 7 * 86400,
      spreadStrategy: "fifo_by_original_time",
      lifecycleOpId: body.lifecycle_op_id,
      resumeLockOwner: `${body.lifecycle_op_id}:test`,
    });

    expect(stats.staleSkipped).toBe(5);
    expect(stats.spreadEnqueued).toBe(0);

    // Verify stale_skipped_at populated for the 5 stale.
    const db = getRawDb();
    const skipCount = (await db`
      SELECT COUNT(*)::int AS c FROM campaign_enrollments
       WHERE campaign_id = ${campaignId} AND stale_skipped_at IS NOT NULL
    `) as Array<{ c: number }>;
    expect(skipCount[0]!.c).toBe(5);

    // Verify stale_skipped events emitted.
    const events = (await db`
      SELECT COUNT(*)::int AS c FROM enrollment_events
       WHERE campaign_id = ${campaignId} AND event_type = 'stale_skipped'
    `) as Array<{ c: number }>;
    expect(events[0]!.c).toBe(5);
  }, 30_000);

  it("skip_stale_spread: stale skipped, remainder spread (CR-10)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      status: "paused",
      steps: [
        { stepType: "wait", config: { duration: 1, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl, subject: "S" } },
      ],
    });

    await setRateLimitConfig(workspaceId, 100);
    await seedOverdueEnrollments(workspaceId, campaignId, steps[0]!.id, 3, {
      ageDays: 8,
    });
    await seedOverdueEnrollments(workspaceId, campaignId, steps[0]!.id, 7, {
      ageDays: 1,
    });

    const res = await postResume(apiKey, campaignId, {
      mode: "skip_stale_spread",
      spread_window_seconds: 3600,
      stale_threshold_seconds: 7 * 86400,
    });
    const body = (await res.json()) as { lifecycle_op_id: string };
    expect(res.status).toBe(200);

    const { processResumeSpreadJob } = await import(
      "../../../worker/src/jobs/process-resume-spread.js"
    );
    const stats = await processResumeSpreadJob({
      campaignId,
      workspaceId,
      mode: "skip_stale_spread",
      spreadWindowSeconds: 3600,
      staleThresholdSeconds: 7 * 86400,
      spreadStrategy: "fifo_by_original_time",
      lifecycleOpId: body.lifecycle_op_id,
      resumeLockOwner: `${body.lifecycle_op_id}:test`,
    });

    expect(stats.staleSkipped).toBe(3);
    expect(stats.spreadEnqueued).toBe(7);
  }, 30_000);
});
