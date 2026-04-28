/**
 * Campaign cancellation: when a campaign transitions to paused, archived,
 * or is deleted, all of its active enrollments must be marked terminal AND
 * their pending wait-step jobs must be removed from BullMQ.
 *
 * Cancellation strategy: EXACT jobId per enrollment (no Redis SCAN, no
 * wildcard patterns — see DB-02 in 03-plan.md).
 *
 * Status semantics:
 *   - "paused"    — pause: resumable in principle (resume not yet implemented)
 *   - "cancelled" — archive/delete: terminal
 *
 * In-flight send-email jobs are NOT cancelled here — they are short-lived
 * (≤ 1 Resend API call) and cancelling mid-call would leak network state.
 * Only step-execution (wait) jobs are cancellable.
 */

import { Queue } from "bullmq";
import { getDb } from "@openmail/shared/db";
import { campaignEnrollments } from "@openmail/shared/schema";
import { eq, and } from "drizzle-orm";
import { getQueueRedisConnection } from "./redis.js";
import { logger } from "./logger.js";

let _stepQueue: Queue | null = null;
function getStepQueue(): Queue {
  if (!_stepQueue) {
    _stepQueue = new Queue("step-execution", { connection: getQueueRedisConnection() });
  }
  return _stepQueue;
}

export async function cancelCampaignJobs(
  campaignId: string,
  terminalStatus: "paused" | "cancelled",
): Promise<{ cancelled: number }> {
  const db = getDb();

  // 1. Load active enrollments (id + currentStepId only — minimal projection).
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

  if (rows.length === 0) {
    return { cancelled: 0 };
  }

  // 2. Remove pending wait-step jobs by EXACT jobId. Idempotent.
  const queue = getStepQueue();
  for (const row of rows) {
    if (!row.currentStepId) continue;
    const jobId = `step-execution__${row.id}__${row.currentStepId}`;
    try {
      await queue.remove(jobId);
    } catch (err) {
      logger.warn({ jobId, err }, "campaign-cancel: queue.remove failed (Redis error)");
    }
  }

  // 3. Bulk-update enrollment status. completedAt set only for terminal "cancelled".
  await db
    .update(campaignEnrollments)
    .set({
      status: terminalStatus,
      updatedAt: new Date(),
      ...(terminalStatus === "cancelled" ? { completedAt: new Date() } : {}),
    })
    .where(and(
      eq(campaignEnrollments.campaignId, campaignId),
      eq(campaignEnrollments.status, "active"),
    ));

  logger.info(
    { campaignId, terminalStatus, cancelled: rows.length },
    "campaign-cancel: marked enrollments terminal and removed pending jobs",
  );

  return { cancelled: rows.length };
}
