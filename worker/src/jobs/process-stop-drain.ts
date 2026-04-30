/**
 * Stop-drain sweeper worker (Stage 2 — T12, REQ-13, [A2.7], CR-07, CN-09).
 *
 * Periodically scans `campaigns.status = 'stopping'` and promotes them to
 * `'stopped'` once all progressing enrollments have exited. Held-during-drain
 * enrollments (those with `step_held_at IS NOT NULL`) are force-exited per
 * [A2.7]: marked `force_exited_at = NOW()` + `force_exited` audit event +
 * status flipped to `'completed'`.
 *
 * Queue:        `lifecycle-drain-sweeper` ([V2.11 ambiguity-3])
 * Schedule:     repeatable every `LIFECYCLE_DRAIN_SWEEPER_INTERVAL_MS` ms
 *               (default 60000 = 60s) per [DB-07].
 * Op-id:        per-sweep `lop_sweeper_<12char>` lets operators correlate all
 *               force_exited events from the same sweep run ([V2.5]).
 *
 * Idempotency (CR-07): `WHERE status = 'stopping'` clause means re-runs that
 * happen while a tx is in flight produce 0-row updates, no double-counting.
 *
 * Per CN-09: held enrollments do NOT block drain — they get force-exited.
 * Only `status='active' AND step_held_at IS NULL` blocks drain completion.
 */

import { Queue, Worker } from "bullmq";
import { sql, eq, and, isNull, isNotNull } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import {
  campaigns,
  campaignEnrollments,
  campaignSteps,
} from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import {
  getQueueRedisConnection,
  getWorkerRedisConnection,
} from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import {
  commitLifecycleStatus,
  IllegalTransitionError,
} from "../lib/commit-lifecycle-status.js";
import { audit, type AuditTx } from "../lib/lifecycle-audit.js";
import {
  getJobsForStep,
  untagJob,
} from "../lib/step-job-tagging.js";

// ────────────────────────────────────────────────────────────────────────────
// Stage 3 (T6, [A3.3]) — orphan spread token sweep.
// ────────────────────────────────────────────────────────────────────────────

let _stepQueueForOrphanSweep: Queue | null = null;
function getStepQueueForOrphanSweep(): Queue {
  if (!_stepQueueForOrphanSweep) {
    _stepQueueForOrphanSweep = new Queue("step-execution", {
      connection: getQueueRedisConnection(),
    });
  }
  return _stepQueueForOrphanSweep;
}

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────

const QUEUE_NAME = "lifecycle-drain-sweeper" as const;
const JOB_NAME = "drain-sweep" as const;

function getSweepIntervalMs(): number {
  const raw = process.env.LIFECYCLE_DRAIN_SWEEPER_INTERVAL_MS;
  const n = raw ? Number.parseInt(raw, 10) : 60_000;
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

// ────────────────────────────────────────────────────────────────────────────
// Queue handle (lazy)
// ────────────────────────────────────────────────────────────────────────────

let _queue: Queue | null = null;
function getDrainSweeperQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: getQueueRedisConnection() });
  }
  return _queue;
}

/**
 * Idempotently install the repeatable schedule. Safe to call on every boot —
 * BullMQ deduplicates by jobId. Must be invoked from `worker/src/index.ts`
 * AFTER the worker is created so the schedule and consumer match.
 */
export async function ensureDrainSweeperSchedule(): Promise<void> {
  const intervalMs = getSweepIntervalMs();
  const queue = getDrainSweeperQueue();
  // Stable jobId so reboots don't fan-out duplicate schedules.
  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: { every: intervalMs },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
      jobId: `${QUEUE_NAME}:repeat`,
    },
  );
  logger.info(
    { queue: QUEUE_NAME, intervalMs },
    "drain-sweeper schedule installed",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sweep body
// ────────────────────────────────────────────────────────────────────────────

interface SweepStats {
  stoppingCampaignsScanned: number;
  drained: number;
  durationMs: number;
  lifecycle_op_id: string;
  /** Stage 3 [A3.3] — orphan spread tokens reconciled. */
  orphanReEnqueued: number;
  orphanJobsRemoved: number;
  /** Stage 4 [A4.2] — held-step orphan jobs reconciled. */
  heldStepOrphansRemoved: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Stage 3 — orphan spread-token reconciliation [A3.3]
// ────────────────────────────────────────────────────────────────────────────
//
// Two directions:
//
//  A) DB row has spread_token + next_run_at, but no matching BullMQ delayed
//     job exists. Cause: crash after spread_token write but before BullMQ
//     enqueue (the CR-02 idempotency window). Fix: re-enqueue with the
//     remaining delay (max(0, next_run_at - now)).
//
//  B) BullMQ delayed job exists for a wait-step jobId pattern but the
//     corresponding enrollment has spread_token IS NULL. Cause: spread token
//     was cleared (e.g. enrollment cancelled mid-spread). Fix: remove the
//     orphan BullMQ job.
//
// Idempotent across runs — both directions act only on rows/jobs whose state
// is plainly inconsistent. No duplicate work on subsequent passes.

async function sweepOrphanSpreadTokens(
  log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void; debug: (...a: unknown[]) => void },
): Promise<{ orphanReEnqueued: number; orphanJobsRemoved: number }> {
  const db = getDb();
  const stepQueue = getStepQueueForOrphanSweep();

  // ── Direction A: DB has spread_token + next_run_at but no matching job. ─
  // Read enrollments with non-null spread_token AND non-null next_run_at AND
  // status='active' (so paused/completed don't drag in stale tokens).
  const candidateA = (await db.execute(sql`
    SELECT id, current_step_id AS "currentStepId",
           next_run_at         AS "nextRunAt",
           spread_token        AS "spreadToken"
      FROM campaign_enrollments
     WHERE spread_token IS NOT NULL
       AND next_run_at  IS NOT NULL
       AND status       = 'active'
       AND current_step_id IS NOT NULL
     LIMIT 1000
  `)) as unknown as Array<{
    id: string;
    currentStepId: string;
    nextRunAt: Date | string;
    spreadToken: string;
  }>;

  let orphanReEnqueued = 0;
  for (const row of candidateA) {
    const jobId = `step-execution:${row.id}:${row.currentStepId}`;
    // BullMQ Job lookup by id — Queue.getJob is exact-id (NOT a SCAN).
    const existing = await stepQueue.getJob(jobId);
    if (existing) continue; // job exists — not orphan

    const nextRunAt =
      row.nextRunAt instanceof Date ? row.nextRunAt : new Date(row.nextRunAt);
    const remainingMs = Math.max(0, nextRunAt.getTime() - Date.now());

    try {
      await stepQueue.add(
        "step-execution",
        { enrollmentId: row.id, stepId: row.currentStepId },
        {
          delay: remainingMs,
          jobId,
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
      orphanReEnqueued += 1;
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (!/duplicat/i.test(msg)) {
        log.error(
          { enrollmentId: row.id, jobId, err: msg },
          "drain-sweeper orphan-A: re-enqueue failed",
        );
      }
    }
  }

  // ── Direction B: BullMQ delayed job exists but enrollment has no token. ─
  // We bound this scan because there is no cheap way to enumerate ALL
  // delayed jobs without a SCAN-equivalent walk. Instead we read enrollments
  // whose spread_token IS NULL but who have a wait step (currentStepId set)
  // — for each, we lookup the deterministic jobId. If a delayed job exists
  // that corresponds to such an enrollment AND has a delay still pending,
  // it's orphan iff the enrollment was supposed to be tokened (status not
  // active OR completed).
  //
  // Practical guard: only act on enrollments status IN ('completed',
  // 'cancelled', 'failed') with current_step_id set (the wait jobId would
  // otherwise be expected to already have fired).
  const candidateB = (await db.execute(sql`
    SELECT id, current_step_id AS "currentStepId"
      FROM campaign_enrollments
     WHERE spread_token IS NULL
       AND current_step_id IS NOT NULL
       AND status IN ('completed', 'cancelled', 'failed')
     LIMIT 1000
  `)) as unknown as Array<{ id: string; currentStepId: string }>;

  let orphanJobsRemoved = 0;
  for (const row of candidateB) {
    const jobId = `step-execution:${row.id}:${row.currentStepId}`;
    try {
      const existing = await stepQueue.getJob(jobId);
      if (!existing) continue;
      // Only remove if not already running.
      const state = await existing.getState();
      if (state === "delayed" || state === "waiting") {
        await existing.remove();
        orphanJobsRemoved += 1;
      }
    } catch (err) {
      log.warn(
        { enrollmentId: row.id, jobId, err: (err as Error).message },
        "drain-sweeper orphan-B: lookup/remove failed (idempotent skip)",
      );
    }
  }

  if (orphanReEnqueued > 0 || orphanJobsRemoved > 0) {
    log.info(
      { orphanReEnqueued, orphanJobsRemoved },
      "drain-sweeper: orphan spread tokens reconciled",
    );
  }

  return { orphanReEnqueued, orphanJobsRemoved };
}

// ────────────────────────────────────────────────────────────────────────────
// Stage 4 [A4.2] — held-step orphan-job sweep.
// ────────────────────────────────────────────────────────────────────────────
//
// Per-step pause's exhaustive job-cancel runs AFTER the DB tx commits. If the
// process crashes between commit and BullMQ removal:
//   - step.status = 'paused' (committed in tx)
//   - some BullMQ jobs are still tagged with the stepId in Redis SADD set
//   - those jobs would fire on schedule and try to advance held enrollments
//
// Recovery: every sweep, walk paused steps; for each tagged job that still
// exists in BullMQ, remove + untag. Idempotent: a step that never had jobs
// after pause produces empty SET; a step we successfully cleaned has no
// remaining tags.
//
// This is the second-line safety net for CR-02 (exhaustive cancel).

async function sweepHeldStepOrphanJobs(log: {
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
  debug: (...a: unknown[]) => void;
}): Promise<{ heldStepOrphansRemoved: number }> {
  const db = getDb();
  const stepQueue = getStepQueueForOrphanSweep();

  // Candidate steps: status='paused'. Bound to 500 to limit per-sweep work.
  const pausedSteps = (await db
    .select({ id: campaignSteps.id })
    .from(campaignSteps)
    .where(eq(campaignSteps.status, "paused"))
    .limit(500)) as Array<{ id: string }>;

  let heldStepOrphansRemoved = 0;
  for (const step of pausedSteps) {
    const jobIds = await getJobsForStep(step.id);
    for (const jobId of jobIds) {
      try {
        const job = await stepQueue.getJob(jobId);
        if (!job) {
          // Stale tag — clear it to keep the SET tidy.
          await untagJob(step.id, jobId).catch(() => {});
          continue;
        }
        await job.remove();
        await untagJob(step.id, jobId).catch(() => {});
        heldStepOrphansRemoved++;
      } catch (err) {
        log.warn(
          { stepId: step.id, jobId, err: (err as Error).message },
          "drain-sweeper: held-step orphan removal failed (idempotent skip)",
        );
      }
    }
  }

  if (heldStepOrphansRemoved > 0) {
    log.info(
      { heldStepOrphansRemoved },
      "drain-sweeper: held-step orphan jobs reconciled",
    );
  }

  return { heldStepOrphansRemoved };
}

async function sweepOnce(): Promise<SweepStats> {
  const start = Date.now();
  const db = getDb();
  // One op_id per sweep run — operator can group all force_exited and
  // drain_completed events from the same sweep.
  const lifecycleOpId = generateId("lop_sweeper");
  const log = logger.child({ lifecycle_op_id: lifecycleOpId, queue: QUEUE_NAME });

  // 1. Snapshot all 'stopping' campaigns (read outside any transaction —
  //    drain decisions are made per-campaign in their own atomic boundary).
  const stoppingCampaigns = await db
    .select({
      id: campaigns.id,
      workspaceId: campaigns.workspaceId,
    })
    .from(campaigns)
    .where(eq(campaigns.status, "stopping"));

  let drained = 0;

  for (const campaign of stoppingCampaigns) {
    try {
      const didDrain = await db.transaction(async (tx: AuditTx) => {
        // Re-read inside tx to guard against concurrent verb-handler resume.
        // (`stop_drain_started → resume` is illegal at the API surface, but
        // Stage-2 re-asserts here as defense-in-depth.)
        const stillStopping = (await tx
          .select({ id: campaigns.id, status: campaigns.status })
          .from(campaigns)
          .where(eq(campaigns.id, campaign.id))
          .limit(1)) as Array<{ id: string; status: string }>;
        if (stillStopping[0]?.status !== "stopping") {
          return false;
        }

        // Count progressing enrollments — those NOT held at a paused step.
        const progressingRows = (await tx
          .select({ id: campaignEnrollments.id })
          .from(campaignEnrollments)
          .where(
            and(
              eq(campaignEnrollments.campaignId, campaign.id),
              eq(campaignEnrollments.status, "active"),
              isNull(campaignEnrollments.stepHeldAt),
            ),
          )) as Array<{ id: string }>;

        if (progressingRows.length > 0) {
          // Drain not done yet — held enrollments do NOT block drain (CN-09)
          // but progressing ones DO. Wait for next sweep.
          log.debug(
            {
              campaignId: campaign.id,
              progressingCount: progressingRows.length,
            },
            "campaign still draining — progressing enrollments remain",
          );
          return false;
        }

        // Held-during-drain force-exit (per [A2.7]).
        const heldRows = (await tx
          .select({
            id: campaignEnrollments.id,
            contactId: campaignEnrollments.contactId,
            status: campaignEnrollments.status,
          })
          .from(campaignEnrollments)
          .where(
            and(
              eq(campaignEnrollments.campaignId, campaign.id),
              eq(campaignEnrollments.status, "active"),
              isNotNull(campaignEnrollments.stepHeldAt),
            ),
          )) as Array<{ id: string; contactId: string; status: string }>;

        for (const held of heldRows) {
          // Mark force_exited_at first (per [A2.7] sequence).
          await tx.execute(sql`
            UPDATE campaign_enrollments
               SET force_exited_at = NOW(),
                   updated_at      = NOW()
             WHERE id = ${held.id}
          `);

          // Emit force_exited event BEFORE flipping status — readers replaying
          // the event log see the force_exit reason precede the terminal state.
          await audit.emit(
            held.id,
            "force_exited",
            {
              campaignId: campaign.id,
              workspaceId: campaign.workspaceId,
              contactId: held.contactId,
              actor: { kind: "sweeper", runId: lifecycleOpId },
              payload: {
                lifecycle_op_id: lifecycleOpId,
                reason: "held_at_paused_step_during_drain",
              },
            },
            tx,
          );

          // Transition the enrollment to 'completed' through the audited helper.
          // Stage 1 uses 'completed' as the canonical terminal status when an
          // enrollment cannot continue progressing.
          await commitLifecycleStatus(
            tx,
            "campaign_enrollments",
            held.id,
            "active",
            "completed",
            {
              lifecycleOpId,
              actor: { kind: "sweeper", runId: lifecycleOpId },
              workspaceId: campaign.workspaceId,
              contactId: held.contactId,
              eventTypeOverride: "force_exited",
              extraPayload: {
                reason: "held_at_paused_step_during_drain",
              },
            },
          );
        }

        // Promote the campaign: stopping → stopped (emits drain_completed).
        await commitLifecycleStatus(
          tx,
          "campaigns",
          campaign.id,
          "stopping",
          "stopped",
          {
            lifecycleOpId,
            actor: { kind: "sweeper", runId: lifecycleOpId },
            workspaceId: campaign.workspaceId,
            extraPayload: {
              held_force_exited_count: heldRows.length,
            },
          },
        );

        return true;
      });

      if (didDrain) drained += 1;
    } catch (err) {
      // IllegalTransitionError is the expected race outcome (concurrent
      // resume) — log + continue. Other errors propagate to BullMQ.
      if (err instanceof IllegalTransitionError) {
        log.warn(
          {
            campaignId: campaign.id,
            from: err.expectedFrom,
            actual: err.actualStatus,
          },
          "drain-sweeper: campaign no longer in expected state, skipping",
        );
        continue;
      }
      throw err;
    }
  }

  // Stage 3 [A3.3] — orphan spread-token reconciliation runs on every sweep.
  let orphanReEnqueued = 0;
  let orphanJobsRemoved = 0;
  try {
    const orphanStats = await sweepOrphanSpreadTokens(log);
    orphanReEnqueued = orphanStats.orphanReEnqueued;
    orphanJobsRemoved = orphanStats.orphanJobsRemoved;
  } catch (err) {
    log.error(
      { err: (err as Error).message },
      "drain-sweeper: orphan sweep failed (continuing)",
    );
  }

  // Stage 4 [A4.2] — held-step orphan-job reconciliation. Catches paused
  // steps where BullMQ removal failed mid-flight (crash between tx commit
  // and queue.remove). Idempotent across runs.
  let heldStepOrphansRemoved = 0;
  try {
    const heldStats = await sweepHeldStepOrphanJobs(log);
    heldStepOrphansRemoved = heldStats.heldStepOrphansRemoved;
  } catch (err) {
    log.error(
      { err: (err as Error).message },
      "drain-sweeper: held-step orphan sweep failed (continuing)",
    );
  }

  const stats: SweepStats = {
    stoppingCampaignsScanned: stoppingCampaigns.length,
    drained,
    durationMs: Date.now() - start,
    lifecycle_op_id: lifecycleOpId,
    orphanReEnqueued,
    orphanJobsRemoved,
    heldStepOrphansRemoved,
  };
  log.info(stats, "drain-sweep completed");
  return stats;
}

// ────────────────────────────────────────────────────────────────────────────
// Worker
// ────────────────────────────────────────────────────────────────────────────

export function createStopDrainWorker() {
  return new Worker(
    QUEUE_NAME,
    async () => {
      return await sweepOnce();
    },
    {
      connection: getWorkerRedisConnection(),
      // Sweeper is single-flight per replica; multiple replicas converge via
      // the WHERE status='stopping' idempotency clause (CR-07).
      concurrency: 1,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    },
  );
}

// Re-export for tests.
export { sweepOnce as _sweepOnceForTests };
