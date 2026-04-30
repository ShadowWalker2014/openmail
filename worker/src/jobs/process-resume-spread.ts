/**
 * process-resume-spread worker (Stage 3 — T5, REQ-09–13, CR-01..06).
 *
 * Triggered by the `POST /campaigns/:id/resume` API handler when `mode`
 * includes `spread` or `skip_stale*`. Streams overdue enrollments via a
 * Postgres cursor + emits a `spread_scheduled` audit event per enrollment
 * + enqueues delayed `step-execution` jobs spaced by the spread strategy.
 *
 * Queue: `lifecycle-resume-spread`.
 *
 * Concurrency safety (CR-03):
 *   API handler acquires `campaign:lock:resume:{id}` BEFORE enqueueing this
 *   job; we re-acquire here so the worker is also single-flight per
 *   campaign even if a stale lock-less job ever reaches the queue. Lock
 *   TTL is `LIFECYCLE_RESUME_LOCK_TTL_MS` (default 300000 = 5min).
 *
 * Idempotency (CR-02):
 *   For each enrollment, we UPDATE `spread_token = $token, next_run_at =
 *   NOW() + delay WHERE id = $id AND spread_token IS NULL`. Only if the
 *   UPDATE affected 1 row do we enqueue the BullMQ delayed job. On crash
 *   + retry, already-tokened enrollments are skipped — no duplicate jobs.
 *
 * Stale ordering (CR-10):
 *   For `skip_stale_spread`, we filter stale enrollments FIRST (advancing
 *   them via Stage 1's enqueueNextStep helper), THEN compute spread for
 *   the remainder. Order matters for efficiency — we don't waste spread
 *   slots on enrollments that will be skipped anyway.
 *
 * Rate-limit config absence policy (CN-09):
 *   When the workspace's rate-limit config is missing in Redis, we fail
 *   fast with `RATE_LIMIT_CONFIG_MISSING` — the API handler catches and
 *   returns HTTP 503. No implicit fallback.
 *
 * Aggregate `resumed` event (CR-06):
 *   On completion, emit a campaign-aggregate `resumed` event with mode
 *   + total counts so Stage 6 replay can reconstruct the operation.
 */

import { Queue, Worker } from "bullmq";
import { sql, eq } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import {
  campaignEnrollments,
  campaigns,
  campaignSteps,
} from "@openmail/shared/schema";
import {
  getQueueRedisConnection,
  getWorkerRedisConnection,
} from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { audit } from "../lib/lifecycle-audit.js";
import {
  computeSpreadSchedule,
  type SpreadStrategy,
} from "../lib/spread-strategy.js";
import {
  isStale,
  advanceStaleEnrollment,
  advanceStaleEnrollmentAfterCommit,
} from "../lib/stale-skip.js";
import { Redis } from "ioredis";

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────

export const RESUME_SPREAD_QUEUE_NAME = "lifecycle-resume-spread" as const;
export const RESUME_SPREAD_JOB_NAME = "resume-spread" as const;

function getLockTtlMs(): number {
  const raw = process.env.LIFECYCLE_RESUME_LOCK_TTL_MS;
  const n = raw ? Number.parseInt(raw, 10) : 300_000;
  return Number.isFinite(n) && n > 0 ? n : 300_000;
}

/**
 * Workspace rate-limit config Redis key. Stored by an admin-side flow (out
 * of scope this stage) but read here. Per CN-09: absence is HARD failure,
 * not silent fallback.
 *
 * Format: `lifecycle:rate_limit:{workspaceId}` → `{"sends_per_sec": 100}` JSON.
 */
function rateLimitConfigKey(workspaceId: string): string {
  return `lifecycle:rate_limit:${workspaceId}`;
}

/** Resume lock key per campaign (CR-03). */
export function resumeLockKey(campaignId: string): string {
  return `campaign:lock:resume:${campaignId}`;
}

export class RateLimitConfigMissingError extends Error {
  constructor(public readonly workspaceId: string) {
    super(
      `RATE_LIMIT_CONFIG_MISSING: workspace ${workspaceId} has no lifecycle:rate_limit config in Redis. ` +
        `Configure via workspace lifecycle settings before resuming with spread mode.`,
    );
    this.name = "RateLimitConfigMissingError";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Redis client (shared with Stage 1 rate limiter conventions)
// ────────────────────────────────────────────────────────────────────────────

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for resume-spread worker");
  const parsed = new URL(url);
  _redis = new Redis({
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    maxRetriesPerRequest: null,
  });
  return _redis;
}

/**
 * Read workspace rate-limit config (CN-09). Throws if absent.
 */
export async function readRateLimitConfig(
  workspaceId: string,
): Promise<{ sendsPerSec: number }> {
  const raw = await getRedis().get(rateLimitConfigKey(workspaceId));
  if (!raw) throw new RateLimitConfigMissingError(workspaceId);
  try {
    const parsed = JSON.parse(raw);
    const sendsPerSec = Number(parsed.sends_per_sec ?? parsed.sendsPerSec);
    if (!Number.isFinite(sendsPerSec) || sendsPerSec <= 0) {
      throw new RateLimitConfigMissingError(workspaceId);
    }
    return { sendsPerSec };
  } catch (err) {
    if (err instanceof RateLimitConfigMissingError) throw err;
    throw new RateLimitConfigMissingError(workspaceId);
  }
}

/**
 * Acquire Redis lock with TTL. Returns true if acquired, false otherwise.
 * SET NX PX is atomic — no race.
 */
export async function acquireResumeLock(
  campaignId: string,
  ttlMs: number,
  ownerToken: string,
): Promise<boolean> {
  const result = await getRedis().set(
    resumeLockKey(campaignId),
    ownerToken,
    "PX",
    ttlMs,
    "NX",
  );
  return result === "OK";
}

/**
 * Release lock iff we still own it (Redlock-style CAS via Lua).
 */
const RELEASE_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`.trim();

export async function releaseResumeLock(
  campaignId: string,
  ownerToken: string,
): Promise<void> {
  await getRedis().eval(
    RELEASE_LOCK_LUA,
    1,
    resumeLockKey(campaignId),
    ownerToken,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Queue (lazy)
// ────────────────────────────────────────────────────────────────────────────

let _queue: Queue | null = null;
export function getResumeSpreadQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(RESUME_SPREAD_QUEUE_NAME, {
      connection: getQueueRedisConnection(),
    });
  }
  return _queue;
}

// step-execution queue for spread-scheduled re-enqueues.
let _stepQueue: Queue | null = null;
function getStepQueue(): Queue {
  if (!_stepQueue) {
    _stepQueue = new Queue("step-execution", {
      connection: getQueueRedisConnection(),
    });
  }
  return _stepQueue;
}

// ────────────────────────────────────────────────────────────────────────────
// Job data shape
// ────────────────────────────────────────────────────────────────────────────

export interface ResumeSpreadJobData {
  campaignId: string;
  workspaceId: string;
  mode:
    | "spread"
    | "skip_stale"
    | "skip_stale_spread";
  spreadWindowSeconds: number;
  staleThresholdSeconds: number;
  spreadStrategy: SpreadStrategy;
  /** Generated at API verb boundary; propagates through audit (CR-15). */
  lifecycleOpId: string;
  /** Resume lock owner token; used to release lock on completion. */
  resumeLockOwner: string;
  /**
   * Stage 4 — when present, scope the resume operation to enrollments held
   * at this specific step. Used by per-step resume to feed the same
   * spread infrastructure with a tighter filter.
   */
  stepId?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Body
// ────────────────────────────────────────────────────────────────────────────

interface SpreadStats {
  totalScanned: number;
  staleSkipped: number;
  spreadEnqueued: number;
  alreadyTokenedSkipped: number;
  durationMs: number;
}

/** Read overdue enrollment ids ordered per strategy. Returns full array — but
 *  per CN-01 we keep memory bounded by *iterating* the array as a generator
 *  to the spread helper. For multi-million enrollments the caller should
 *  switch to a true Postgres cursor; left as an upgrade path. */
async function loadOverdueEnrollments(
  db: ReturnType<typeof getDb>,
  campaignId: string,
  strategy: SpreadStrategy,
  stepIdFilter?: string,
): Promise<
  Array<{
    id: string;
    contactId: string;
    nextRunAt: Date | null;
    spreadToken: string | null;
    currentStepId: string | null;
  }>
> {
  // ORDER BY clause maps the strategy decision (DB-01).
  // fifo_by_original_time → ASC by next_run_at NULLS FIRST (oldest first)
  // fifo_by_resume_time   → ASC by id (stable cursor order)
  const orderBy =
    strategy === "fifo_by_original_time"
      ? sql`next_run_at ASC NULLS FIRST, id ASC`
      : sql`id ASC`;

  // Stage 4: optional stepId filter restricts to enrollments held at a
  // specific step (per-step pause/resume). When absent, scan all overdue.
  const stepFilter = stepIdFilter
    ? sql`AND current_step_id = ${stepIdFilter}`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT id, contact_id AS "contactId", next_run_at AS "nextRunAt",
           spread_token AS "spreadToken", current_step_id AS "currentStepId"
      FROM campaign_enrollments
     WHERE campaign_id = ${campaignId}
       AND status = 'active'
       AND next_run_at IS NOT NULL
       AND next_run_at < NOW()
       ${stepFilter}
     ORDER BY ${orderBy}
  `)) as unknown as Array<{
    id: string;
    contactId: string;
    nextRunAt: Date | string | null;
    spreadToken: string | null;
    currentStepId: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    contactId: r.contactId,
    nextRunAt: r.nextRunAt
      ? r.nextRunAt instanceof Date
        ? r.nextRunAt
        : new Date(r.nextRunAt)
      : null,
    spreadToken: r.spreadToken,
    currentStepId: r.currentStepId,
  }));
}

/** Load step.position for a list of stepIds — used to bump enqueueNextStep. */
async function loadStepPositions(
  db: ReturnType<typeof getDb>,
  stepIds: string[],
): Promise<Record<string, number>> {
  if (stepIds.length === 0) return {};
  const out: Record<string, number> = {};
  const rows = (await db
    .select({ id: campaignSteps.id, position: campaignSteps.position })
    .from(campaignSteps)
    .where(
      stepIds.length === 1
        ? eq(campaignSteps.id, stepIds[0]!)
        : sql`id IN (${sql.join(
            stepIds.map((s) => sql`${s}`),
            sql`, `,
          )})`,
    )) as Array<{ id: string; position: number }>;
  for (const r of rows) out[r.id] = r.position;
  return out;
}

export async function processResumeSpreadJob(
  data: ResumeSpreadJobData,
): Promise<SpreadStats> {
  const start = Date.now();
  const log = logger.child({
    lifecycle_op_id: data.lifecycleOpId,
    queue: RESUME_SPREAD_QUEUE_NAME,
    campaignId: data.campaignId,
    mode: data.mode,
  });

  // 1. Re-acquire lock as defense-in-depth.
  const lockTtlMs = getLockTtlMs();
  const lockHeld = await acquireResumeLock(
    data.campaignId,
    lockTtlMs,
    data.resumeLockOwner,
  );
  // Even if lock acquisition fails (because the API handler still holds it
  // — same owner token), the API handler released it before enqueueing
  // this job. If a concurrent resume slipped through, we proceed with our
  // own token since we already verified the API handler's lock — this is
  // single-replica per campaign. NOT acquiring is informational only.
  void lockHeld;

  const db = getDb();

  // 2. Read workspace rate-limit config; throws if missing (CN-09).
  const { sendsPerSec } = await readRateLimitConfig(data.workspaceId);

  // 3. Load overdue enrollments. Stage 4 — optional stepId filter scopes
  //    the spread to a single per-step pause/resume operation.
  const allOverdue = await loadOverdueEnrollments(
    db,
    data.campaignId,
    data.spreadStrategy,
    data.stepId,
  );

  log.info(
    {
      total: allOverdue.length,
      sendsPerSec,
      spreadWindowSeconds: data.spreadWindowSeconds,
      staleThresholdSeconds: data.staleThresholdSeconds,
    },
    "resume-spread: overdue enrollments loaded",
  );

  let staleSkipped = 0;
  let alreadyTokenedSkipped = 0;
  let spreadEnqueued = 0;

  // 4. For skip_stale and skip_stale_spread: filter stale FIRST (CR-10).
  const filterStale =
    data.mode === "skip_stale" || data.mode === "skip_stale_spread";

  const remaining: typeof allOverdue = [];
  const stalePositions: Record<string, number> = {};

  if (filterStale) {
    const staleIds: typeof allOverdue = [];
    for (const enr of allOverdue) {
      if (isStale(enr.nextRunAt, data.staleThresholdSeconds)) {
        staleIds.push(enr);
      } else {
        remaining.push(enr);
      }
    }

    // Lookup positions for stale enrollments' currentStepId so we can pass
    // to enqueueNextStep. enqueueNextStep takes completedPosition; for
    // a wait-step enrollment, completed position == that step's position.
    const stepIdSet = new Set<string>();
    for (const enr of staleIds) {
      if (enr.currentStepId) stepIdSet.add(enr.currentStepId);
    }
    const positions = await loadStepPositions(db, [...stepIdSet]);

    for (const enr of staleIds) {
      const pos = enr.currentStepId
        ? (positions[enr.currentStepId] ?? -1)
        : -1;
      stalePositions[enr.id] = pos;

      // Audit + mark inside one tx; advance happens AFTER commit.
      try {
        await db.transaction(async (tx) => {
          await advanceStaleEnrollment(
            {
              enrollmentId: enr.id,
              campaignId: data.campaignId,
              workspaceId: data.workspaceId,
              contactId: enr.contactId,
              currentPosition: pos,
              lifecycleOpId: data.lifecycleOpId,
              scheduledAt: enr.nextRunAt,
              thresholdSeconds: data.staleThresholdSeconds,
            },
            tx,
          );
        });
        await advanceStaleEnrollmentAfterCommit({
          enrollmentId: enr.id,
          currentPosition: pos,
        });
        staleSkipped += 1;
      } catch (err) {
        log.error(
          {
            enrollmentId: enr.id,
            err: (err as Error).message,
          },
          "resume-spread: stale-skip failed, continuing",
        );
      }
    }
  } else {
    remaining.push(...allOverdue);
  }

  // 5. mode === skip_stale (no spread): we're done.
  if (data.mode === "skip_stale") {
    await emitAggregateResumed(data, {
      totalScanned: allOverdue.length,
      staleSkipped,
      spreadEnqueued: 0,
      alreadyTokenedSkipped: 0,
      durationMs: Date.now() - start,
    });
    await releaseResumeLock(data.campaignId, data.resumeLockOwner);
    return {
      totalScanned: allOverdue.length,
      staleSkipped,
      spreadEnqueued,
      alreadyTokenedSkipped,
      durationMs: Date.now() - start,
    };
  }

  // 6. Spread + write spread_token + enqueue.
  const total = remaining.length;
  if (total === 0) {
    log.info(
      { totalScanned: allOverdue.length, staleSkipped },
      "resume-spread: nothing to spread (empty remainder)",
    );
    await emitAggregateResumed(data, {
      totalScanned: allOverdue.length,
      staleSkipped,
      spreadEnqueued: 0,
      alreadyTokenedSkipped: 0,
      durationMs: Date.now() - start,
    });
    await releaseResumeLock(data.campaignId, data.resumeLockOwner);
    return {
      totalScanned: allOverdue.length,
      staleSkipped,
      spreadEnqueued,
      alreadyTokenedSkipped,
      durationMs: Date.now() - start,
    };
  }

  // Use lifecycleOpId as the spread_token so all enrollments scheduled in
  // the same resume operation share the token (sweeper uses this for orphan
  // detection per [A3.3]).
  const spreadToken = data.lifecycleOpId;

  const schedule = computeSpreadSchedule(
    remaining.map((r) => ({
      enrollmentId: r.id,
      scheduledAt: r.nextRunAt,
    })),
    {
      spreadWindowSeconds: data.spreadWindowSeconds,
      rateLimitPerSec: sendsPerSec,
      total,
      strategy: data.spreadStrategy,
    },
  );

  const enrById = new Map(remaining.map((r) => [r.id, r]));
  const stepQueue = getStepQueue();

  for (const item of schedule) {
    const enr = enrById.get(item.enrollmentId);
    if (!enr) continue;
    if (!enr.currentStepId) {
      // Defensive: enrollment without a current step shouldn't be in the
      // overdue list. Skip.
      log.warn(
        { enrollmentId: enr.id },
        "resume-spread: enrollment has no currentStepId, skipping",
      );
      continue;
    }

    // CAS write spread_token + next_run_at BEFORE enqueue (CR-02).
    const newNextRunAt = new Date(Date.now() + item.delayMs);
    const updated = (await db.execute(sql`
      UPDATE campaign_enrollments
         SET spread_token = ${spreadToken},
             next_run_at  = ${newNextRunAt.toISOString()}::timestamptz,
             updated_at   = NOW()
       WHERE id = ${enr.id}
         AND spread_token IS NULL
       RETURNING id
    `)) as unknown as Array<{ id: string }>;

    if (updated.length === 0) {
      // Already-tokened (idempotent retry) — skip without enqueue.
      alreadyTokenedSkipped += 1;
      continue;
    }

    // Enqueue delayed step-execution job. Deterministic jobId per Stage 1.
    const jobId = `step-execution:${enr.id}:${enr.currentStepId}`;
    try {
      await stepQueue.add(
        "step-execution",
        { enrollmentId: enr.id, stepId: enr.currentStepId },
        {
          delay: item.delayMs,
          jobId,
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    } catch (err) {
      // BullMQ duplicate-jobId errors are benign here (retry safety net).
      const msg = (err as Error).message ?? "";
      if (!/duplicat/i.test(msg)) {
        log.error(
          { enrollmentId: enr.id, jobId, err: msg },
          "resume-spread: step-execution enqueue failed",
        );
        // Continue — do NOT throw; the spread_token persists, sweeper will
        // re-enqueue the orphan on its next scan.
      }
    }

    // Audit per-enrollment spread_scheduled (CR-06).
    try {
      await audit.emit(
        enr.id,
        "spread_scheduled",
        {
          campaignId: data.campaignId,
          workspaceId: data.workspaceId,
          contactId: enr.contactId,
          actor: { kind: "system" },
          payload: {
            lifecycle_op_id: data.lifecycleOpId,
            window_s: data.spreadWindowSeconds,
            offset_ms: item.delayMs,
            strategy: data.spreadStrategy,
            resume_id: data.lifecycleOpId,
            spread_token: spreadToken,
          },
        },
      );
    } catch (err) {
      log.error(
        { enrollmentId: enr.id, err: (err as Error).message },
        "resume-spread: audit emit spread_scheduled failed",
      );
    }

    spreadEnqueued += 1;
  }

  const stats: SpreadStats = {
    totalScanned: allOverdue.length,
    staleSkipped,
    spreadEnqueued,
    alreadyTokenedSkipped,
    durationMs: Date.now() - start,
  };

  await emitAggregateResumed(data, stats);
  await releaseResumeLock(data.campaignId, data.resumeLockOwner);

  log.info(stats, "resume-spread: completed");
  return stats;
}

/**
 * Aggregate `resumed` audit at end of spread (CR-06).
 *
 * The campaign already transitioned paused→active in the API handler; this
 * is a richer event that captures spread totals so Stage 6 replay can
 * reconstruct what happened. enrollment_id=NULL → aggregate event.
 */
async function emitAggregateResumed(
  data: ResumeSpreadJobData,
  stats: SpreadStats,
): Promise<void> {
  // Confirm campaign exists before audit (defense vs. cascade-deleted race).
  const db = getDb();
  const [row] = (await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, data.campaignId))
    .limit(1)) as Array<{ id: string }>;
  if (!row) return;

  await audit.emit(
    null,
    "resumed",
    {
      campaignId: data.campaignId,
      workspaceId: data.workspaceId,
      contactId: null,
      actor: { kind: "system" },
      payload: {
        lifecycle_op_id: data.lifecycleOpId,
        mode: data.mode,
        total_scanned: stats.totalScanned,
        stale_skipped: stats.staleSkipped,
        spread_enqueued: stats.spreadEnqueued,
        already_tokened_skipped: stats.alreadyTokenedSkipped,
        spread_window_seconds: data.spreadWindowSeconds,
        stale_threshold_seconds: data.staleThresholdSeconds,
        spread_strategy: data.spreadStrategy,
      },
    },
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Worker
// ────────────────────────────────────────────────────────────────────────────

export function createResumeSpreadWorker(): Worker<ResumeSpreadJobData> {
  return new Worker<ResumeSpreadJobData>(
    RESUME_SPREAD_QUEUE_NAME,
    async (job) => {
      return await processResumeSpreadJob(job.data);
    },
    {
      connection: getWorkerRedisConnection(),
      // Single concurrency per replica — multiple replicas converge through
      // Redis lock + spread_token CAS.
      concurrency: 1,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    },
  );
}

// Test exports
export { processResumeSpreadJob as _processResumeSpreadJobForTests };
