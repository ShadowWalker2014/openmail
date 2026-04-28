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
 * Cancellation: cancelEnrollmentJob removes pending wait jobs by EXACT jobId
 * (no Redis SCAN, no wildcard pattern). In-flight send-email jobs are NOT
 * cancellable — they are short-lived (≤ 1 Resend API call).
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
import { eq, asc, gt, and } from "drizzle-orm";
import { generateId } from "@openmail/shared/ids";
import { logger } from "./logger.js";

// ── Lazy-init queues ─────────────────────────────────────────────────────────

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

// ── Wait-step duration parser ────────────────────────────────────────────────

type WaitUnit = "hours" | "days" | "weeks";
interface WaitConfig {
  duration: number;
  unit: WaitUnit;
}

const UNIT_TO_MS: Record<WaitUnit, number> = {
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
};

function computeDelayMs(config: unknown): number {
  const c = config as Partial<WaitConfig>;
  if (typeof c.duration !== "number" || c.duration <= 0) {
    throw new Error(`Invalid wait step config: duration must be a positive number, got ${JSON.stringify(c.duration)}`);
  }
  if (c.unit !== "hours" && c.unit !== "days" && c.unit !== "weeks") {
    throw new Error(`Invalid wait step config: unit must be one of hours|days|weeks, got ${JSON.stringify(c.unit)}`);
  }
  return c.duration * UNIT_TO_MS[c.unit];
}

interface EmailStepConfig {
  templateId?: string;
  subject?: string;
  htmlContent?: string;
  fromName?: string;
  fromEmail?: string;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Advance an enrollment to the next step strictly after `completedPosition`.
 *
 * @param enrollmentId       campaign_enrollments.id
 * @param completedPosition  position of the step that just completed.
 *                           Pass -1 to start from the very first step (entry).
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
    logger.warn({ enrollmentId }, "step-advance: enrollment not found");
    return;
  }
  if (enrollment.status !== "active") {
    logger.info(
      { enrollmentId, status: enrollment.status },
      "step-advance: enrollment not active, skipping",
    );
    return;
  }

  // 2. Find next step (strictly greater position, ascending).
  const [nextStep] = await db
    .select()
    .from(campaignSteps)
    .where(and(
      eq(campaignSteps.campaignId, enrollment.campaignId),
      gt(campaignSteps.position, completedPosition),
    ))
    .orderBy(asc(campaignSteps.position))
    .limit(1);

  // 3. No next step → completed.
  if (!nextStep) {
    await db
      .update(campaignEnrollments)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(campaignEnrollments.id, enrollmentId));
    logger.info({ enrollmentId, completedPosition }, "step-advance: enrollment completed");
    return;
  }

  // 4. Dispatch by step type.
  if (nextStep.stepType === "email") {
    await dispatchEmailStep(enrollment, nextStep);
    return;
  }
  if (nextStep.stepType === "wait") {
    await dispatchWaitStep(enrollment, nextStep);
    return;
  }

  // 5. Unknown step type — defensive failure.
  logger.error(
    { enrollmentId, stepId: nextStep.id, stepType: nextStep.stepType },
    "step-advance: unknown step type, marking enrollment failed",
  );
  await db
    .update(campaignEnrollments)
    .set({ status: "failed", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(campaignEnrollments.id, enrollmentId));
}

async function dispatchEmailStep(
  enrollment: typeof campaignEnrollments.$inferSelect,
  step: typeof campaignSteps.$inferSelect,
): Promise<void> {
  const db = getDb();

  // Load contact to check unsubscribed + populate contactEmail.
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, enrollment.contactId))
    .limit(1);

  if (!contact) {
    logger.warn(
      { enrollmentId: enrollment.id, contactId: enrollment.contactId },
      "step-advance: contact not found, marking enrollment completed",
    );
    await db
      .update(campaignEnrollments)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(campaignEnrollments.id, enrollment.id));
    return;
  }

  if (contact.unsubscribed) {
    logger.info(
      { enrollmentId: enrollment.id, contactId: contact.id },
      "step-advance: contact unsubscribed, completing enrollment without send",
    );
    await db
      .update(campaignEnrollments)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(campaignEnrollments.id, enrollment.id));
    return;
  }

  const stepConfig = step.config as EmailStepConfig;
  const sendId = generateId("snd");

  // Insert email_sends row. status="queued" until send-email worker processes it.
  await db.insert(emailSends).values({
    id: sendId,
    workspaceId: enrollment.workspaceId,
    contactId: contact.id,
    contactEmail: contact.email,
    campaignId: enrollment.campaignId,
    campaignStepId: step.id,
    subject: stepConfig.subject ?? "Message from us",
    status: "queued",
  });

  // ENQUEUE FIRST (per header comment — avoids stranded enrollments on UPDATE failure).
  await getSendEmailQueue().add(
    "send-email",
    {
      sendId,
      enrollmentId: enrollment.id,
      campaignStepPosition: step.position,
    },
    {
      jobId: `send-email__${sendId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  );

  // THEN UPDATE enrollment cursor.
  await db
    .update(campaignEnrollments)
    .set({ currentStepId: step.id, updatedAt: new Date() })
    .where(eq(campaignEnrollments.id, enrollment.id));

  logger.info(
    { enrollmentId: enrollment.id, stepId: step.id, sendId, position: step.position },
    "step-advance: email step queued",
  );
}

async function dispatchWaitStep(
  enrollment: typeof campaignEnrollments.$inferSelect,
  step: typeof campaignSteps.$inferSelect,
): Promise<void> {
  const db = getDb();
  const delayMs = computeDelayMs(step.config);

  // ENQUEUE FIRST.
  await getStepQueue().add(
    "step-execution",
    { enrollmentId: enrollment.id, stepId: step.id },
    {
      delay: delayMs,
      jobId: `step-execution__${enrollment.id}__${step.id}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  );

  // THEN UPDATE enrollment cursor.
  await db
    .update(campaignEnrollments)
    .set({ currentStepId: step.id, updatedAt: new Date() })
    .where(eq(campaignEnrollments.id, enrollment.id));

  logger.info(
    { enrollmentId: enrollment.id, stepId: step.id, delayMs, position: step.position },
    "step-advance: wait step scheduled",
  );
}

/**
 * Cancel a pending wait-step job for an enrollment.
 *
 * Uses EXACT jobId — no Redis SCAN, no wildcard pattern. Idempotent.
 * Only cancels step-execution (wait) jobs. In-flight send-email jobs are
 * not cancellable (short-lived; cancelling mid-Resend-call would leak network state).
 */
export async function cancelEnrollmentJob(
  enrollmentId: string,
  currentStepId: string | null,
): Promise<void> {
  if (!currentStepId) return;
  const jobId = `step-execution__${enrollmentId}__${currentStepId}`;
  try {
    await getStepQueue().remove(jobId);
  } catch (err) {
    // remove() on a non-existent jobId returns 0; only network/Redis errors throw.
    logger.warn({ jobId, err }, "step-advance: cancel failed (Redis error)");
  }
}
