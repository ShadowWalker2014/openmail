/**
 * Stage 4 — Per-Step Pause/Resume verb routes (REQ-08, CR-01..08).
 *
 *   POST /api/v1/campaigns/:id/steps/:stepId/pause
 *   POST /api/v1/campaigns/:id/steps/:stepId/resume
 *     body: { mode: "immediate" | "spread" | "skip_stale" | "skip_stale_spread",
 *             spread_window_seconds?, stale_threshold_seconds?, spread_strategy? }
 *
 * Pattern mirrors `campaigns.lifecycle.ts` (Stage 2). Both endpoints:
 *   - Generate or honor `lifecycle_op_id` at the boundary
 *   - Acquire a per-step Redis lock to serialize concurrent pause/resume
 *   - Wrap mutations in `db.transaction()`
 *   - Pass through audit chokepoint via `SET LOCAL lifecycle.audited_tx = 'true'`
 *   - Are idempotent on already-paused/already-active steps (CR-04)
 *
 * Pause flow (CR-01..02):
 *   1. CAS UPDATE `campaign_steps SET status='paused' WHERE status='active'`
 *      → if 0 rows changed, return idempotent response
 *   2. UPDATE held enrollments: `step_held_at=now()` for any active enrollment
 *      whose currentStepId matches and step_held_at IS NULL
 *   3. Audit emit: `step_paused` (campaign-aggregate) + per-enrollment `step_held`
 *   4. After commit: enumerate jobs from Redis SET via `getJobsForStep(stepId)`,
 *      remove each from BullMQ exhaustively (CR-02), then SREM the SET keys
 *
 * Resume flow (CR-06):
 *   - Reuses Stage 3 spread infrastructure for `spread`/`skip_stale_spread` modes
 *   - For `immediate`: per held enrollment call Stage 1 `enqueueNextStep` with
 *     position=stepPosition-1 so it advances back into the same step and
 *     re-enqueues the wait job
 *   - For `spread`: enqueue a `process-resume-spread` job filtered to this stepId
 *   - For `skip_stale`: advance held enrollments past the step using
 *     Stage 3's stale-skip helper
 *
 * Lock: `campaign:lock:step:{stepId}:pause`, TTL `LIFECYCLE_PER_STEP_LOCK_TTL_MS`
 *  (default 30000ms).
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { eq, and, isNull, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { getDb } from "@openmail/shared/db";
import {
  campaigns,
  campaignSteps,
  campaignEnrollments,
} from "@openmail/shared/schema";
import {
  LIFECYCLE_OP_ID_LENGTH,
  LIFECYCLE_PER_STEP_LOCK_TTL_MS_DEFAULT,
  SPREAD_WINDOW_MIN_SECONDS,
  SPREAD_WINDOW_MAX_SECONDS,
} from "@openmail/shared";
import { audit, type Actor } from "../../../worker/src/lib/lifecycle-audit.js";
import {
  getJobsForStep,
  clearStepTags,
} from "../../../worker/src/lib/step-job-tagging.js";
import { enqueueNextStep } from "../../../worker/src/lib/step-advance.js";
import {
  RESUME_SPREAD_JOB_NAME,
  getResumeSpreadQueue,
  readRateLimitConfig,
  RateLimitConfigMissingError,
  type ResumeSpreadJobData,
} from "../../../worker/src/jobs/process-resume-spread.js";
import { logger } from "../lib/logger.js";
import type { ApiVariables } from "../types.js";

// ─── Op-id ───────────────────────────────────────────────────────────────────
const opIdAlphabet = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  LIFECYCLE_OP_ID_LENGTH,
);
function resolveOpId(headerVal: string | undefined): string {
  const trimmed = headerVal?.trim();
  if (trimmed && trimmed.length >= LIFECYCLE_OP_ID_LENGTH) return trimmed;
  return `lop_step_${opIdAlphabet()}`;
}

// ─── Actor ───────────────────────────────────────────────────────────────────
function resolveActor(c: { get: (k: string) => unknown }): Actor {
  const userId = c.get("userId") as string | undefined;
  const apiKeyId = c.get("apiKeyId") as string | undefined;
  if (apiKeyId) return { kind: "agent_key", apiKeyId };
  if (userId) return { kind: "user", userId };
  return { kind: "system" };
}

// ─── Redis (lock + queue) ────────────────────────────────────────────────────
let _redis: Redis | null = null;
function getRedis(): Redis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for step pause routes");
  const parsed = new URL(url);
  _redis = new Redis({
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });
  return _redis;
}

let _stepQueue: Queue | null = null;
function getStepQueue(): Queue {
  if (_stepQueue) return _stepQueue;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL required for step queue");
  const parsed = new URL(url);
  _stepQueue = new Queue("step-execution", {
    connection: {
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
      username: parsed.username || undefined,
    },
  });
  return _stepQueue;
}

function stepLockKey(stepId: string): string {
  return `campaign:lock:step:${stepId}:pause`;
}

async function acquireStepLock(
  stepId: string,
  owner: string,
  ttlMs: number,
): Promise<boolean> {
  // SET NX PX — atomic acquire.
  const result = await getRedis().set(
    stepLockKey(stepId),
    owner,
    "PX",
    ttlMs,
    "NX",
  );
  return result === "OK";
}

async function releaseStepLock(stepId: string, owner: string): Promise<void> {
  // Lua script: only delete if value matches owner (avoid releasing someone else's lock).
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  await getRedis().eval(script, 1, stepLockKey(stepId), owner);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchCampaignAndStep(
  workspaceId: string,
  campaignId: string,
  stepId: string,
) {
  const db = getDb();
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!campaign) return { campaign: null, step: null };
  const [step] = await db
    .select()
    .from(campaignSteps)
    .where(
      and(
        eq(campaignSteps.id, stepId),
        eq(campaignSteps.campaignId, campaignId),
        eq(campaignSteps.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return { campaign, step: step ?? null };
}

// ─── Router ──────────────────────────────────────────────────────────────────

const app = new Hono<{ Variables: ApiVariables }>();

/**
 * POST /:id/steps/:stepId/pause
 *
 * 1. Acquire `campaign:lock:step:{stepId}:pause`
 * 2. Tx: CAS step active→paused; mark held enrollments; emit audit events
 * 3. Post-commit: enumerate tagged BullMQ jobs and remove each
 * 4. Release lock
 */
app.post("/:id/steps/:stepId/pause", async (c) => {
  const start = Date.now();
  const workspaceId = c.get("workspaceId") as string;
  const campaignId = c.req.param("id");
  const stepId = c.req.param("stepId");
  const lifecycleOpId = resolveOpId(c.req.header("X-Lifecycle-Op-Id"));
  const childLogger = logger.child({ lifecycle_op_id: lifecycleOpId });

  const { campaign, step } = await fetchCampaignAndStep(
    workspaceId,
    campaignId,
    stepId,
  );
  if (!campaign || !step) return c.json({ error: "Not found" }, 404);

  // Idempotent: already paused → return without acquiring lock.
  if (step.status === "paused") {
    return c.json({
      step,
      lifecycle_op_id: lifecycleOpId,
      idempotent: true,
      held_count: 0,
      cancelled_jobs: 0,
    });
  }

  const lockTtlMs = Number.parseInt(
    process.env.LIFECYCLE_PER_STEP_LOCK_TTL_MS ??
      String(LIFECYCLE_PER_STEP_LOCK_TTL_MS_DEFAULT),
    10,
  );
  const lockOwner = `${lifecycleOpId}:${Date.now()}`;
  const acquired = await acquireStepLock(stepId, lockOwner, lockTtlMs);
  if (!acquired) {
    return c.json(
      {
        error: "STEP_PAUSE_IN_PROGRESS",
        message:
          "Another pause/resume is in progress for this step. Try again shortly.",
      },
      409,
    );
  }

  let heldCount = 0;
  let cancelledJobs = 0;
  const db = getDb();
  const actor = resolveActor(c);

  try {
    // Tx: pause-CAS + hold enrollments + audit events.
    await db.transaction(async (tx) => {
      // Audit chokepoint pass for any campaigns trigger interactions.
      await tx.execute(sql`SET LOCAL lifecycle.audited_tx = 'true'`);

      // 1. CAS UPDATE on step.
      const updated = await tx
        .update(campaignSteps)
        .set({ status: "paused", pausedAt: new Date() })
        .where(
          and(
            eq(campaignSteps.id, stepId),
            eq(campaignSteps.status, "active"),
          ),
        )
        .returning({ id: campaignSteps.id });

      if (updated.length === 0) {
        // Race: another request paused first. Treat as idempotent.
        return;
      }

      // 2. Mark held enrollments. We pull the held set first so we can audit
      // each one in this transaction.
      const heldEnrollments = await tx
        .select({
          id: campaignEnrollments.id,
          contactId: campaignEnrollments.contactId,
        })
        .from(campaignEnrollments)
        .where(
          and(
            eq(campaignEnrollments.currentStepId, stepId),
            eq(campaignEnrollments.status, "active"),
            isNull(campaignEnrollments.stepHeldAt),
          ),
        );

      if (heldEnrollments.length > 0) {
        await tx
          .update(campaignEnrollments)
          .set({ stepHeldAt: new Date() })
          .where(
            and(
              eq(campaignEnrollments.currentStepId, stepId),
              eq(campaignEnrollments.status, "active"),
              isNull(campaignEnrollments.stepHeldAt),
            ),
          );
      }
      heldCount = heldEnrollments.length;

      // 3. Audit emit: campaign-aggregate `step_paused` first.
      await audit.emit(
        null,
        "step_paused",
        {
          campaignId,
          workspaceId,
          contactId: null,
          actor,
          payload: {
            lifecycle_op_id: lifecycleOpId,
            step_id: stepId,
            step_position: step.position,
            held_count: heldCount,
          },
          before: { step_status: "active" },
          after: { step_status: "paused" },
        },
        tx,
      );

      // Per-enrollment `step_held` events.
      for (const enr of heldEnrollments) {
        await audit.emit(
          enr.id,
          "step_held",
          {
            campaignId,
            workspaceId,
            contactId: enr.contactId,
            actor,
            payload: {
              lifecycle_op_id: lifecycleOpId,
              step_id: stepId,
              step_position: step.position,
            },
            before: { step_held_at: null },
            after: { step_held_at: "now" },
          },
          tx,
        );
      }
    });

    // 4. Post-commit: enumerate tagged BullMQ jobs and remove each (CR-02).
    const jobIds = await getJobsForStep(stepId);
    const queue = getStepQueue();
    for (const jobId of jobIds) {
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
          cancelledJobs++;
        }
      } catch (err) {
        childLogger.warn(
          { err: (err as Error).message, jobId },
          "step-pause: BullMQ removal failed (non-fatal)",
        );
      }
    }
    // Empty the bucket — sweeper (T7) covers any orphans from crashes.
    await clearStepTags(stepId).catch(() => {});
  } finally {
    await releaseStepLock(stepId, lockOwner);
  }

  childLogger.info(
    {
      campaignId,
      stepId,
      verb: "pause",
      held_count: heldCount,
      cancelled_jobs: cancelledJobs,
      durationMs: Date.now() - start,
    },
    "step lifecycle verb committed",
  );

  // Re-fetch the step so the response reflects post-pause state.
  const refreshed = await getDb()
    .select()
    .from(campaignSteps)
    .where(eq(campaignSteps.id, stepId))
    .limit(1);
  return c.json({
    step: refreshed[0] ?? null,
    lifecycle_op_id: lifecycleOpId,
    held_count: heldCount,
    cancelled_jobs: cancelledJobs,
  });
});

/**
 * POST /:id/steps/:stepId/resume
 */
const resumeBodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("immediate") }),
  z.object({
    mode: z.literal("spread"),
    spread_window_seconds: z.number().int().positive().optional(),
    spread_strategy: z
      .enum(["fifo_by_original_time", "fifo_by_resume_time"])
      .optional(),
  }),
  z.object({
    mode: z.literal("skip_stale"),
    stale_threshold_seconds: z.number().int().positive().optional(),
  }),
  z.object({
    mode: z.literal("skip_stale_spread"),
    spread_window_seconds: z.number().int().positive().optional(),
    stale_threshold_seconds: z.number().int().positive().optional(),
    spread_strategy: z
      .enum(["fifo_by_original_time", "fifo_by_resume_time"])
      .optional(),
  }),
]);

app.post(
  "/:id/steps/:stepId/resume",
  zValidator("json", resumeBodySchema.optional()),
  async (c) => {
    const start = Date.now();
    const workspaceId = c.get("workspaceId") as string;
    const campaignId = c.req.param("id");
    const stepId = c.req.param("stepId");
    const lifecycleOpId = resolveOpId(c.req.header("X-Lifecycle-Op-Id"));
    const childLogger = logger.child({ lifecycle_op_id: lifecycleOpId });
    const body = c.req.valid("json") ?? { mode: "immediate" as const };

    const { campaign, step } = await fetchCampaignAndStep(
      workspaceId,
      campaignId,
      stepId,
    );
    if (!campaign || !step) return c.json({ error: "Not found" }, 404);

    // Idempotent: already active → return.
    if (step.status === "active") {
      return c.json({
        step,
        lifecycle_op_id: lifecycleOpId,
        idempotent: true,
        mode: body.mode,
        resumed_count: 0,
      });
    }

    // Bounds check spread window if applicable.
    if (body.mode === "spread" || body.mode === "skip_stale_spread") {
      const w = body.spread_window_seconds;
      if (
        typeof w === "number" &&
        (w < SPREAD_WINDOW_MIN_SECONDS || w > SPREAD_WINDOW_MAX_SECONDS)
      ) {
        return c.json(
          {
            error: "INVALID_SPREAD_WINDOW",
            min_seconds: SPREAD_WINDOW_MIN_SECONDS,
            max_seconds: SPREAD_WINDOW_MAX_SECONDS,
            received: w,
          },
          400,
        );
      }
    }

    // Rate-limit config presence for spread modes (CN-09 from Stage 3).
    if (body.mode === "spread" || body.mode === "skip_stale_spread") {
      try {
        await readRateLimitConfig(workspaceId);
      } catch (err) {
        if (err instanceof RateLimitConfigMissingError) {
          return c.json(
            {
              error: "RATE_LIMIT_CONFIG_MISSING",
              message:
                "Workspace has no lifecycle rate-limit config. Configure it before resuming with spread mode.",
            },
            503,
          );
        }
        throw err;
      }
    }

    const lockTtlMs = Number.parseInt(
      process.env.LIFECYCLE_PER_STEP_LOCK_TTL_MS ??
        String(LIFECYCLE_PER_STEP_LOCK_TTL_MS_DEFAULT),
      10,
    );
    const lockOwner = `${lifecycleOpId}:${Date.now()}`;
    const acquired = await acquireStepLock(stepId, lockOwner, lockTtlMs);
    if (!acquired) {
      return c.json(
        {
          error: "STEP_PAUSE_IN_PROGRESS",
          message:
            "Another pause/resume is in progress for this step. Try again shortly.",
        },
        409,
      );
    }

    const db = getDb();
    const actor = resolveActor(c);
    let heldEnrollments: Array<{ id: string; contactId: string }> = [];
    let resumedCount = 0;

    try {
      // Tx: flip step active + read held enrollments + clear stepHeldAt + audit.
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lifecycle.audited_tx = 'true'`);

        // CAS step paused→active.
        const updated = await tx
          .update(campaignSteps)
          .set({ status: "active", pausedAt: null })
          .where(
            and(
              eq(campaignSteps.id, stepId),
              eq(campaignSteps.status, "paused"),
            ),
          )
          .returning({ id: campaignSteps.id });
        if (updated.length === 0) {
          // Race: someone resumed first.
          return;
        }

        heldEnrollments = await tx
          .select({
            id: campaignEnrollments.id,
            contactId: campaignEnrollments.contactId,
          })
          .from(campaignEnrollments)
          .where(
            and(
              eq(campaignEnrollments.currentStepId, stepId),
              eq(campaignEnrollments.status, "active"),
            ),
          );

        if (heldEnrollments.length > 0) {
          await tx
            .update(campaignEnrollments)
            .set({ stepHeldAt: null })
            .where(
              and(
                eq(campaignEnrollments.currentStepId, stepId),
                eq(campaignEnrollments.status, "active"),
              ),
            );
        }

        // Audit `step_resumed` aggregate event w/ step config snapshot.
        await audit.emit(
          null,
          "step_resumed",
          {
            campaignId,
            workspaceId,
            contactId: null,
            actor,
            payload: {
              lifecycle_op_id: lifecycleOpId,
              step_id: stepId,
              step_position: step.position,
              step_config_snapshot: step.config,
              mode: body.mode,
              held_count: heldEnrollments.length,
            },
            before: { step_status: "paused" },
            after: { step_status: "active" },
          },
          tx,
        );
      });

      // Mode dispatch — outside the tx, BullMQ + spread worker calls.
      if (body.mode === "immediate") {
        // Re-enqueue each held enrollment. We pass `position-1` so
        // enqueueNextStep advances back into the same step (re-emits the wait
        // job for wait steps; sends an email for email steps).
        for (const enr of heldEnrollments) {
          try {
            await enqueueNextStep(enr.id, step.position - 1);
            resumedCount++;
          } catch (err) {
            childLogger.warn(
              { err: (err as Error).message, enrollmentId: enr.id },
              "step-resume immediate: enqueueNextStep failed",
            );
          }
        }
      } else if (
        body.mode === "spread" ||
        body.mode === "skip_stale_spread"
      ) {
        // Enqueue resume-spread worker scoped to this step. The Stage 3
        // worker reads `next_run_at` and `currentStepId` filters, so we set a
        // synthetic next_run_at on these rows so the worker picks them up.
        await db
          .update(campaignEnrollments)
          .set({ nextRunAt: new Date() })
          .where(
            and(
              eq(campaignEnrollments.campaignId, campaignId),
              eq(campaignEnrollments.currentStepId, stepId),
              eq(campaignEnrollments.status, "active"),
              isNull(campaignEnrollments.spreadToken),
            ),
          );

        const queueData: ResumeSpreadJobData = {
          campaignId,
          workspaceId,
          mode: body.mode,
          spreadWindowSeconds: body.spread_window_seconds ?? 14400,
          staleThresholdSeconds:
            body.mode === "skip_stale_spread"
              ? body.stale_threshold_seconds ?? 604800
              : 604800,
          spreadStrategy: body.spread_strategy ?? "fifo_by_original_time",
          lifecycleOpId,
          resumeLockOwner: `step:${stepId}:${lockOwner}`,
          stepId,
        };
        await getResumeSpreadQueue().add(RESUME_SPREAD_JOB_NAME, queueData, {
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 50 },
        });
        resumedCount = heldEnrollments.length; // optimistic — worker drives finalization
      } else if (body.mode === "skip_stale") {
        // For skip_stale on per-step: any held enrollment older than threshold
        // is advanced past the step; the rest are re-enqueued at now.
        const staleMs =
          (body.stale_threshold_seconds ?? 604800) * 1000;
        const now = Date.now();
        for (const enr of heldEnrollments) {
          // Read the held timestamp + advance or re-enqueue.
          const [row] = await db
            .select({ stepHeldAt: campaignEnrollments.stepHeldAt })
            .from(campaignEnrollments)
            .where(eq(campaignEnrollments.id, enr.id))
            .limit(1);
          const heldAt = row?.stepHeldAt;
          // Note: stepHeldAt was just cleared in the tx above; we use pause_id
          // semantics (any held enrollment past threshold by step's
          // `paused_at`).
          const stepPausedAt = step.pausedAt
            ? new Date(step.pausedAt as unknown as string).getTime()
            : (heldAt ? new Date(heldAt as unknown as string).getTime() : now);
          const ageMs = now - stepPausedAt;
          if (ageMs >= staleMs) {
            // Skip past the step.
            try {
              await enqueueNextStep(enr.id, step.position);
              await db
                .update(campaignEnrollments)
                .set({ staleSkippedAt: new Date() })
                .where(eq(campaignEnrollments.id, enr.id));
              await audit.emit(enr.id, "stale_skipped", {
                campaignId,
                workspaceId,
                contactId: enr.contactId,
                actor,
                payload: {
                  lifecycle_op_id: lifecycleOpId,
                  step_id: stepId,
                  reason: "step_resume_skip_stale",
                  age_ms: ageMs,
                  threshold_ms: staleMs,
                },
              });
            } catch (err) {
              childLogger.warn(
                { err: (err as Error).message, enrollmentId: enr.id },
                "step-resume skip_stale: skip-past failed",
              );
            }
          } else {
            try {
              await enqueueNextStep(enr.id, step.position - 1);
              resumedCount++;
            } catch (err) {
              childLogger.warn(
                { err: (err as Error).message, enrollmentId: enr.id },
                "step-resume skip_stale: re-enqueue failed",
              );
            }
          }
        }
      }
    } finally {
      // Always release lock; spread worker carries its own resume lock.
      await releaseStepLock(stepId, lockOwner);
    }

    childLogger.info(
      {
        campaignId,
        stepId,
        verb: "resume",
        mode: body.mode,
        held_count: heldEnrollments.length,
        resumed_count: resumedCount,
        durationMs: Date.now() - start,
      },
      "step lifecycle verb committed",
    );

    const refreshed = await getDb()
      .select()
      .from(campaignSteps)
      .where(eq(campaignSteps.id, stepId))
      .limit(1);
    return c.json({
      step: refreshed[0] ?? null,
      lifecycle_op_id: lifecycleOpId,
      mode: body.mode,
      held_count: heldEnrollments.length,
      resumed_count: resumedCount,
    });
  },
);

export default app;
