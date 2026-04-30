/**
 * Step advancement: a campaign enrollment progresses linearly through
 * `campaign_steps` ordered by position. position values are integers ≥ 0.
 *
 * Initial entry: callers (process-event, check-segment) pass completedPosition=-1
 * because the predicate `position > -1` correctly resolves to position 0.
 *
 * Side-effect ordering: we ALWAYS enqueue BullMQ first, THEN UPDATE
 * campaign_enrollments.currentStepId. If the UPDATE fails after enqueue
 * succeeds, jobId dedup catches the (rare) double-fire on retry. The reverse
 * order would create stranded enrollments (DB updated but no job in flight).
 *
 * Cancellation: `step-execution` jobs use deterministic jobIds of the form
 * `step-execution:${enrollmentId}:${stepId}`. Callers cancel via exact-id
 * `Queue.remove(jobId)` — no SCAN, no wildcards (see plan DB-02).
 */
import { Queue } from "bullmq";
import { getQueueRedisConnection } from "./redis.js";
import { getDb } from "@openmail/shared/db";
import {
  campaignEnrollments,
  campaignSteps,
  contacts,
  emailSends,
} from "@openmail/shared/schema";
import { eq, and, asc, gt } from "drizzle-orm";
import { generateId } from "@openmail/shared/ids";
import { logger } from "./logger.js";
// Stage 4 hook: tag wait-step jobs by stepId so per-step pause can enumerate
// + remove them. See worker/src/lib/step-job-tagging.ts. Untag is performed
// in process-step.ts via Worker events ("completed" / "failed") and in
// `cancelEnrollmentJob` below for explicit cancellation paths.
import { tagJob, untagJob } from "./step-job-tagging.js";

// ── Lazy-init queues (env vars only read inside the getter) ─────────────────
let _stepQueue: Queue | null = null;
function getStepQueue(): Queue {
  if (!_stepQueue) {
    _stepQueue = new Queue("step-execution", { connection: getQueueRedisConnection() });
  }
  return _stepQueue;
}

let _sendEmailQueue: Queue | null = null;
function getSendEmailQueue(): Queue {
  if (!_sendEmailQueue) {
    _sendEmailQueue = new Queue("send-email", { connection: getQueueRedisConnection() });
  }
  return _sendEmailQueue;
}

// ── Wait-step config validation ─────────────────────────────────────────────
type WaitUnit = "hours" | "days" | "weeks";
const WAIT_UNIT_MS: Record<WaitUnit, number> = {
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
};

function computeWaitDelayMs(config: unknown): number {
  if (!config || typeof config !== "object") {
    throw new Error("Wait step config must be an object");
  }
  const c = config as { duration?: unknown; unit?: unknown };
  const duration = typeof c.duration === "number" ? c.duration : NaN;
  const unit = c.unit;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Wait step duration must be a positive number; got ${String(c.duration)}`);
  }
  if (unit !== "hours" && unit !== "days" && unit !== "weeks") {
    throw new Error(`Wait step unit must be "hours" | "days" | "weeks"; got ${String(unit)}`);
  }
  return duration * WAIT_UNIT_MS[unit];
}

/**
 * Advance a campaign enrollment past `completedPosition` to the next step.
 *
 * For initial enrollment, callers pass `completedPosition = -1` so the
 * predicate `position > -1` selects position 0.
 *
 * Side effects (ordered):
 *   1. Read enrollment + steps + (optionally) contact.
 *   2. If terminal (no next step or unsubscribed) → mark enrollment completed.
 *   3. Otherwise: enqueue BullMQ job, THEN UPDATE enrollment.currentStepId.
 *
 * No-ops (returns without error):
 *   - enrollment not found
 *   - enrollment.status !== "active"
 *
 * Throws (BullMQ retries):
 *   - DB connectivity
 *   - Queue connectivity
 *   - Invalid wait-step config
 *   - Unknown stepType (defensive — schema permits "email" | "wait" but
 *     config is JSONB so we validate at runtime)
 */
export async function enqueueNextStep(
  enrollmentId: string,
  completedPosition: number,
): Promise<void> {
  const db = getDb();

  // 1. Load enrollment.
  const [enrollment] = await db
    .select()
    .from(campaignEnrollments)
    .where(eq(campaignEnrollments.id, enrollmentId))
    .limit(1);

  if (!enrollment) {
    logger.warn({ enrollmentId }, "enqueueNextStep: enrollment not found");
    return;
  }
  if (enrollment.status !== "active") {
    logger.info(
      { enrollmentId, status: enrollment.status },
      "enqueueNextStep: enrollment not active, skipping",
    );
    return;
  }

  // 2. Find the next step by position order.
  const [nextStep] = await db
    .select()
    .from(campaignSteps)
    .where(
      and(
        eq(campaignSteps.campaignId, enrollment.campaignId),
        gt(campaignSteps.position, completedPosition),
      ),
    )
    .orderBy(asc(campaignSteps.position))
    .limit(1);

  if (!nextStep) {
    // Terminal: ran to completion.
    await db
      .update(campaignEnrollments)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(campaignEnrollments.id, enrollmentId));
    logger.info(
      { enrollmentId, campaignId: enrollment.campaignId, completedPosition },
      "Enrollment completed (no further steps)",
    );
    return;
  }

  // 3. Dispatch by stepType.
  if (nextStep.stepType === "email") {
    // 3a. Verify contact + unsubscribe gate.
    const [contact] = await db
      .select({
        id: contacts.id,
        email: contacts.email,
        unsubscribed: contacts.unsubscribed,
      })
      .from(contacts)
      .where(eq(contacts.id, enrollment.contactId))
      .limit(1);

    if (!contact) {
      // Contact deleted between enrollment and now — treat as completion.
      await db
        .update(campaignEnrollments)
        .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(campaignEnrollments.id, enrollmentId));
      logger.warn(
        { enrollmentId, contactId: enrollment.contactId },
        "Enrollment completed: contact missing",
      );
      return;
    }

    if (contact.unsubscribed) {
      // Unsubscribed mid-flow: mark enrollment completed (do not send further).
      await db
        .update(campaignEnrollments)
        .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(campaignEnrollments.id, enrollmentId));
      logger.info(
        { enrollmentId, contactId: contact.id, stepId: nextStep.id },
        "Enrollment completed: contact unsubscribed",
      );
      return;
    }

    // 3b. Insert email_sends row (mirrors process-event.ts:88-98).
    const stepConfig = nextStep.config as { templateId?: string; subject?: string };
    const sendId = generateId("snd");
    await db.insert(emailSends).values({
      id: sendId,
      workspaceId: enrollment.workspaceId,
      contactId: contact.id,
      contactEmail: contact.email,
      campaignId: enrollment.campaignId,
      campaignStepId: nextStep.id,
      subject: stepConfig.subject ?? "Message from us",
      status: "queued",
    });

    // 3c. Enqueue send-email job FIRST (per header comment: ordering matters).
    // jobId is deterministic — both for dedup and so that step-advance failures
    // before the enrollment.currentStepId UPDATE don't strand the enrollment
    // (a retry will re-enqueue with the same jobId, no double-send).
    const sendJobId = `send-email:${sendId}:0`;
    await getSendEmailQueue().add(
      "send-email",
      { sendId, enrollmentId, campaignStepPosition: nextStep.position },
      {
        jobId: sendJobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    );

    // 3d. THEN UPDATE enrollment pointer.
    await db
      .update(campaignEnrollments)
      .set({ currentStepId: nextStep.id, updatedAt: new Date() })
      .where(eq(campaignEnrollments.id, enrollmentId));

    logger.info(
      {
        enrollmentId,
        fromPosition: completedPosition,
        toStepId: nextStep.id,
        toPosition: nextStep.position,
        nextType: "email",
        scheduledJobId: sendJobId,
      },
      "Enrollment advanced to email step",
    );
    return;
  }

  if (nextStep.stepType === "wait") {
    const delayMs = computeWaitDelayMs(nextStep.config);
    const stepJobId = `step-execution:${enrollmentId}:${nextStep.id}`;

    // Enqueue delayed step-execution job FIRST (per header comment).
    await getStepQueue().add(
      "step-execution",
      { enrollmentId, stepId: nextStep.id },
      {
        delay: delayMs,
        jobId: stepJobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    );
    // Stage 4 hook (CR-02): tag this jobId under the step so per-step pause
    // can enumerate + remove it without SCAN. Idempotent SADD; tagJob errors
    // do not poison the enqueue (we log + continue).
    await tagJob(nextStep.id, stepJobId).catch((err) =>
      logger.warn({ err, stepId: nextStep.id, stepJobId }, "tagJob failed (non-fatal)"),
    );

    // THEN UPDATE enrollment pointer.
    await db
      .update(campaignEnrollments)
      .set({ currentStepId: nextStep.id, updatedAt: new Date() })
      .where(eq(campaignEnrollments.id, enrollmentId));

    logger.info(
      {
        enrollmentId,
        fromPosition: completedPosition,
        toStepId: nextStep.id,
        toPosition: nextStep.position,
        nextType: "wait",
        delayMs,
        scheduledJobId: stepJobId,
      },
      "Enrollment advanced to wait step",
    );
    return;
  }

  // Defensive: unknown stepType. Mark enrollment failed; surface via logs.
  // (Schema currently allows only "email" | "wait" via API validation, but
  // config/stepType are TEXT/JSONB columns — runtime guard prevents silent
  // hangs if schema drifts.)
  await db
    .update(campaignEnrollments)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(campaignEnrollments.id, enrollmentId));
  logger.error(
    {
      enrollmentId,
      stepId: nextStep.id,
      stepType: nextStep.stepType,
    },
    "Enrollment failed: unknown step type",
  );
  throw new Error(`Unknown step type "${nextStep.stepType}" on step ${nextStep.id}`);
}

/**
 * Cancel a pending step-execution (wait) job for an enrollment.
 *
 * Idempotent: removing a non-existent jobId returns 0 from BullMQ — no error.
 *
 * Note: this only cancels `step-execution` (wait) jobs. In-flight `send-email`
 * jobs are NOT cancelled — they are short-lived and non-resumable; cancelling
 * mid-Resend-call would leak network state.
 */
export async function cancelEnrollmentJob(
  enrollmentId: string,
  currentStepId: string | null,
): Promise<void> {
  if (!currentStepId) return;
  const jobId = `step-execution:${enrollmentId}:${currentStepId}`;
  await getStepQueue().remove(jobId);
  // Stage 4 hook: untag explicit cancellation so the step's tag SET stays
  // accurate for the sweeper (T7) orphan-detection invariant.
  await untagJob(currentStepId, jobId).catch((err) =>
    logger.warn({ err, stepId: currentStepId, jobId }, "untagJob failed (non-fatal)"),
  );
  logger.info({ enrollmentId, currentStepId, jobId }, "Cancelled step-execution job");
}
