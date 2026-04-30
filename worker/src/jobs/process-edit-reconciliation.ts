/**
 * Stage 6 — Edit reconciliation worker (REQ-10, REQ-12, [A6.1], CR-02, CR-03).
 *
 * Subscribes to the Redis `campaign-edits` channel (published by the outbox
 * worker T9) and reconciles in-flight enrollments to the new edit shape.
 *
 * Idempotency (CR-02):
 *   Redis SET `reconciled:edits:{lifecycle_op_id}` with TTL 24h. Skip if the
 *   key already exists — pub/sub may double-deliver on subscriber reconnect.
 *
 * Per edit_type:
 *   - wait_duration_changed:
 *       Recompute next_run_at = step_entered_at + new delaySeconds for every
 *       in-flight enrollment whose current_step_id == stepId. If retroactively
 *       due (next_run_at < now), enqueue with delay=0 (matching Stage 3's
 *       spread infrastructure for safety; here we just enqueue immediately
 *       and let rate-limiter pace). Otherwise cancel old jobId + enqueue new.
 *       Emit `reconciled` per enrollment.
 *   - step_inserted:
 *       In-flight at position ≥ N skip (no change needed since position is
 *       only consulted at advancement time). Aggregate `reconciled` event.
 *   - step_deleted:
 *       Mostly handled at API layer (campaign-steps DELETE handler calls
 *       `readAndAuditHeldEnrollmentsForStep` + `advanceEnrollmentsPastStepAfterCommit`).
 *       Worker emits aggregate `reconciled` event for traceability.
 *   - email_template_changed:
 *       No-op (live lookup at send time per [DB-08]). Aggregate `reconciled`.
 *   - goal_added:
 *       Enqueue paginated `process-goal-add-reconciliation` worker (T11).
 *   - goal_updated/removed:
 *       Stage 5 publishes its own `goal-cache:invalidate` channel; nothing
 *       to do here.
 *
 * REJECT edits on stopping/stopped/archived campaigns at API layer (T12).
 * Worker should never see those, but if it does, log + skip.
 */
import type { Job, Worker as BullWorker } from "bullmq";
import { Queue, Worker } from "bullmq";
import { sql, eq, and } from "drizzle-orm";
import { Redis } from "ioredis";
import { customAlphabet } from "nanoid";
import { getDb } from "@openmail/shared/db";
import {
  campaignEnrollments,
  campaignSteps,
  campaigns,
} from "@openmail/shared/schema";
import { LIFECYCLE_OP_ID_LENGTH } from "@openmail/shared";
import {
  getQueueRedisConnection,
  getWorkerRedisConnection,
} from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { audit, type Actor } from "../lib/lifecycle-audit.js";
import {
  enqueueNextStep,
  cancelEnrollmentJob,
} from "../lib/step-advance.js";
import { CAMPAIGN_EDITS_CHANNEL } from "./process-outbox.js";

const QUEUE_NAME = "lifecycle-edit-reconciliation" as const;
const JOB_NAME = "reconcile-edit" as const;

const opIdAlphabet = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  LIFECYCLE_OP_ID_LENGTH,
);
function newReconcileOpId(): string {
  return `lop_recon_${opIdAlphabet()}`;
}

const SWEEPER_ACTOR: Actor = { kind: "sweeper", runId: "edit-reconciliation" };

interface EditMessage {
  outboxId: string;
  workspaceId: string;
  campaignId: string;
  editType:
    | "wait_duration_changed"
    | "step_inserted"
    | "step_deleted"
    | "email_template_changed"
    | "goal_added"
    | "goal_updated"
    | "goal_removed";
  details: Record<string, unknown>;
  lifecycleOpId: string;
  createdAt: string;
}

let _sub: Redis | null = null;
function getSubscriber(): Redis {
  if (!_sub) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is required for reconciliation worker");
    const u = new URL(url);
    _sub = new Redis({
      host: u.hostname,
      port: Number(u.port) || 6379,
      password: u.password || undefined,
      username: u.username || undefined,
      maxRetriesPerRequest: null,
    });
  }
  return _sub;
}

let _idempotency: Redis | null = null;
function getIdempotencyClient(): Redis {
  if (!_idempotency) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is required for reconciliation worker");
    const u = new URL(url);
    _idempotency = new Redis({
      host: u.hostname,
      port: Number(u.port) || 6379,
      password: u.password || undefined,
      username: u.username || undefined,
      maxRetriesPerRequest: null,
    });
  }
  return _idempotency;
}

let _queue: Queue<EditMessage> | null = null;
function getQueue(): Queue<EditMessage> {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: getQueueRedisConnection() });
  }
  return _queue;
}

/** Returns true on first call within TTL; false on dup. */
async function tryClaim(opId: string): Promise<boolean> {
  const k = `reconciled:edits:${opId}`;
  const r = await getIdempotencyClient().set(k, "1", "EX", 86_400, "NX");
  return r === "OK";
}

// ─── Per edit-type handlers ─────────────────────────────────────────────────

async function handleWaitDurationChanged(msg: EditMessage): Promise<number> {
  const stepId = msg.details.stepId as string | undefined;
  const newDelaySeconds = msg.details.newDelaySeconds as number | undefined;
  if (!stepId || typeof newDelaySeconds !== "number") {
    logger.warn({ msg }, "wait_duration_changed: missing stepId/newDelaySeconds");
    return 0;
  }
  const db = getDb();
  // Find in-flight enrollments at this step.
  const enrollments = (await db
    .select({
      id: campaignEnrollments.id,
      contactId: campaignEnrollments.contactId,
      stepEnteredAt: campaignEnrollments.stepEnteredAt,
      currentStepId: campaignEnrollments.currentStepId,
    })
    .from(campaignEnrollments)
    .where(
      and(
        eq(campaignEnrollments.currentStepId, stepId),
        eq(campaignEnrollments.status, "active"),
      ),
    )
    .limit(10_000)) as Array<{
    id: string;
    contactId: string;
    stepEnteredAt: Date | null;
    currentStepId: string | null;
  }>;

  let count = 0;
  for (const enr of enrollments) {
    try {
      // Cancel old wait job (idempotent).
      await cancelEnrollmentJob(enr.id, enr.currentStepId);
      // Recompute next_run_at = step_entered_at + new delay
      const enteredAt = enr.stepEnteredAt ?? new Date();
      const newRunAt = new Date(enteredAt.getTime() + newDelaySeconds * 1000);
      await db
        .update(campaignEnrollments)
        .set({ nextRunAt: newRunAt, updatedAt: new Date() })
        .where(eq(campaignEnrollments.id, enr.id));
      // Re-enqueue. We use the Stage 1 helper but need to advance ONE step
      // back so it re-enqueues the same wait. enqueueNextStep selects based
      // on `position > completedPosition`. We'd need stepPosition-1. Since we
      // already cancelled the old job, the simplest path is to read the step
      // position and re-enqueue.
      const [step] = await db
        .select({ position: campaignSteps.position })
        .from(campaignSteps)
        .where(eq(campaignSteps.id, stepId))
        .limit(1);
      if (step) {
        await enqueueNextStep(enr.id, step.position - 1);
      }
      // Audit per-enrollment.
      await audit.emit(
        enr.id,
        "reconciled",
        {
          campaignId: msg.campaignId,
          workspaceId: msg.workspaceId,
          contactId: enr.contactId,
          actor: SWEEPER_ACTOR,
          payload: {
            lifecycle_op_id: msg.lifecycleOpId,
            edit_type: "wait_duration_changed",
            step_id: stepId,
            new_delay_seconds: newDelaySeconds,
          },
          before: { next_run_at: "old" },
          after: { next_run_at: newRunAt.toISOString() },
        },
      );
      count++;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, enrollmentId: enr.id },
        "wait_duration_changed: per-enrollment reconcile failed (continuing)",
      );
    }
  }
  return count;
}

async function handleAggregateOnly(msg: EditMessage): Promise<void> {
  // step_inserted, step_deleted, email_template_changed, goal_updated/removed
  // — no per-enrollment work (deletes already handled at API layer).
  await audit.emit(
    null,
    "reconciled",
    {
      campaignId: msg.campaignId,
      workspaceId: msg.workspaceId,
      contactId: null,
      actor: SWEEPER_ACTOR,
      payload: {
        lifecycle_op_id: msg.lifecycleOpId,
        edit_type: msg.editType,
        details: msg.details,
      },
    },
  );
}

async function handleGoalAdded(msg: EditMessage): Promise<void> {
  // Enqueue the paginated worker (T11).
  // Lazy import to avoid module cycles.
  const { enqueueGoalAddReconciliation } = await import(
    "./process-goal-add-reconciliation.js"
  );
  await enqueueGoalAddReconciliation({
    workspaceId: msg.workspaceId,
    campaignId: msg.campaignId,
    goalId: msg.details.goalId as string,
    lifecycleOpId: msg.lifecycleOpId,
  });
}

// ─── Job processor ──────────────────────────────────────────────────────────

async function processEditMessage(msg: EditMessage): Promise<void> {
  // Idempotency: skip if we've seen this op-id before.
  const claimed = await tryClaim(msg.lifecycleOpId);
  if (!claimed) {
    logger.info(
      { lifecycle_op_id: msg.lifecycleOpId, editType: msg.editType },
      "edit-reconciliation: dup skipped",
    );
    return;
  }

  // Verify campaign not in frozen state — defensive (API rejects, but pub/sub
  // could be in flight when status flips).
  const db = getDb();
  const [c] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, msg.campaignId))
    .limit(1);
  if (c && ["stopping", "stopped", "archived"].includes(c.status)) {
    logger.warn(
      { campaignId: msg.campaignId, status: c.status, editType: msg.editType },
      "edit-reconciliation: skipping edit on frozen campaign",
    );
    return;
  }

  switch (msg.editType) {
    case "wait_duration_changed": {
      const n = await handleWaitDurationChanged(msg);
      logger.info(
        { lifecycle_op_id: msg.lifecycleOpId, count: n, campaignId: msg.campaignId },
        "edit-reconciliation: wait_duration_changed complete",
      );
      break;
    }
    case "step_inserted":
    case "step_deleted":
    case "email_template_changed":
    case "goal_updated":
    case "goal_removed":
      await handleAggregateOnly(msg);
      break;
    case "goal_added":
      await handleGoalAdded(msg);
      // Aggregate `reconciled` is emitted at completion of paginated worker.
      break;
    default: {
      const _exhaustive: never = msg.editType;
      logger.warn({ editType: _exhaustive }, "edit-reconciliation: unknown edit_type");
    }
  }
}

// ─── Subscriber bootstrap ───────────────────────────────────────────────────

let _subscriberStarted = false;
export async function startEditReconciliationSubscriber(): Promise<void> {
  if (_subscriberStarted) return;
  _subscriberStarted = true;
  const sub = getSubscriber();
  await sub.subscribe(CAMPAIGN_EDITS_CHANNEL);
  sub.on("message", async (channel, raw) => {
    if (channel !== CAMPAIGN_EDITS_CHANNEL) return;
    try {
      const msg = JSON.parse(raw) as EditMessage;
      // Push into BullMQ for retry semantics; do NOT process directly here
      // because subscriber handlers shouldn't await long-running DB work.
      await getQueue().add(JOB_NAME, msg, {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      });
    } catch (err) {
      logger.error(
        { err: (err as Error).message, raw },
        "edit-reconciliation: failed to parse / enqueue",
      );
    }
  });
  logger.info(
    { channel: CAMPAIGN_EDITS_CHANNEL },
    "edit-reconciliation: subscriber started",
  );
}

export function createEditReconciliationWorker(): BullWorker<EditMessage> {
  return new Worker<EditMessage>(
    QUEUE_NAME,
    async (job: Job<EditMessage>) => {
      await processEditMessage(job.data);
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: 5,
    },
  );
}

// Test/manual hook
export async function processEditMessageOnce(msg: EditMessage): Promise<void> {
  return processEditMessage(msg);
}
