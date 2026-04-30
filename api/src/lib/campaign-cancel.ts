/**
 * campaign-cancel — cancel pending step-execution jobs and finalise enrollments
 * when a campaign transitions to a terminal/non-running status.
 *
 * Called from:
 *   - PATCH /campaigns/:id   when status flips active → paused | archived
 *   - DELETE /campaigns/:id  before the campaigns row is deleted (cascade
 *                            removes enrollments, but Redis jobs are NOT
 *                            cascade-deleted — we must remove them first).
 *
 * Implementation notes:
 *   - Exact-id `Queue.remove(jobId)` per CN-02 — no SCAN, no wildcards.
 *   - JobId shape mirrors worker/src/lib/step-advance.ts:
 *       step-execution:${enrollmentId}:${currentStepId}
 *     Send-email jobs are NOT cancelled — they are short-lived and cancelling
 *     mid-Resend-call would leak network state (matches `cancelEnrollmentJob`
 *     behaviour in step-advance.ts).
 *   - Status semantics:
 *       paused    — resumable. (Resume-from-pause is OUT OF SCOPE for this
 *                   PRP; documented as a known limitation.)
 *       cancelled — terminal. Used for archive / delete flows.
 *   - The bulk UPDATE only touches rows that are still `active` so we don't
 *     overwrite already-completed/failed enrollments.
 */
import { Queue } from "bullmq";
import { getQueueRedisConnection } from "./redis.js";
import { getDb } from "@openmail/shared/db";
import { campaignEnrollments } from "@openmail/shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger.js";

let _stepQueue: Queue | null = null;
function getStepQueue(): Queue {
  if (!_stepQueue) {
    _stepQueue = new Queue("step-execution", { connection: getQueueRedisConnection() });
  }
  return _stepQueue;
}

export type TerminalEnrollmentStatus = "paused" | "cancelled";

/**
 * Cancel all active enrollments for a campaign:
 *   1. Select active enrollments (id, currentStepId).
 *   2. For each: remove the deterministic `step-execution:${id}:${stepId}` job
 *      from BullMQ (idempotent — no-op if job already ran or never existed).
 *   3. Bulk UPDATE active enrollments → terminalStatus.
 *
 * Returns `{ cancelled }` — number of enrollments transitioned.
 */
export async function cancelCampaignJobs(
  campaignId: string,
  terminalStatus: TerminalEnrollmentStatus,
): Promise<{ cancelled: number }> {
  const db = getDb();

  // 1. Fetch active enrollments — single indexed query.
  const rows = await db
    .select({
      id: campaignEnrollments.id,
      currentStepId: campaignEnrollments.currentStepId,
    })
    .from(campaignEnrollments)
    .where(and(
      eq(campaignEnrollments.campaignId, campaignId),
      eq(campaignEnrollments.status, "active"),
    ));

  // 2. Remove each pending step-execution job by exact id (no SCAN — CN-02).
  //    Send-email jobs are intentionally NOT removed (see header comment).
  const queue = getStepQueue();
  for (const row of rows) {
    if (!row.currentStepId) continue;
    const jobId = `step-execution:${row.id}:${row.currentStepId}`;
    try {
      await queue.remove(jobId);
    } catch (err) {
      // BullMQ throws on locked jobs (currently being processed). Log and
      // continue — the worker will discover the enrollment is no longer
      // active via its own idempotency checks (process-step.ts step 2).
      logger.warn(
        { campaignId, enrollmentId: row.id, jobId, err: (err as Error).message },
        "cancelCampaignJobs: queue.remove failed (job likely active); will be ignored by process-step idempotency",
      );
    }
  }

  // 3. Bulk-flip remaining active enrollments. completedAt only set for
  //    terminal status; paused enrollments retain a null completedAt so a
  //    future resume can distinguish.
  if (rows.length > 0) {
    await db
      .update(campaignEnrollments)
      .set({
        status: terminalStatus,
        updatedAt: new Date(),
        completedAt:
          terminalStatus === "cancelled"
            ? new Date()
            : sql`${campaignEnrollments.completedAt}`,
      })
      .where(and(
        eq(campaignEnrollments.campaignId, campaignId),
        eq(campaignEnrollments.status, "active"),
      ));
  }

  return { cancelled: rows.length };
}
