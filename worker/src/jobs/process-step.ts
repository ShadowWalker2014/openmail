/**
 * process-step worker
 *
 * Consumes the `step-execution` queue. Each job represents a previously
 * scheduled wait step whose delay has elapsed; the worker's job is to verify
 * the enrollment is still at this step and then advance it.
 *
 * Idempotency (validator-required, prevents double-fire after a race with
 * cancellation or re-enrollment):
 *   1. enrollment must exist
 *   2. enrollment.status === "active"
 *   3. enrollment.currentStepId === stepId (the delayed job is otherwise stale)
 *   4. step row must still exist (campaign delete cascade race)
 * Failing any of these → log + return cleanly (NOT throw — retrying would
 * create the orphan job we're trying to avoid).
 *
 * On valid execution: call `enqueueNextStep(enrollmentId, step.position)`.
 *
 * Errors that SHOULD throw (BullMQ retries with exponential backoff):
 *   - DB connectivity loss
 *   - Queue connectivity loss
 *   - Invalid downstream step config (surfaces as configuration bugs)
 */
import { Worker } from "bullmq";
import { getWorkerRedisConnection } from "../lib/redis.js";
import { getDb } from "@openmail/shared/db";
import { campaignEnrollments, campaignSteps } from "@openmail/shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
// Stage 5 (T7): replace direct enqueueNextStep with the goal-aware wrapper so
// wait-step expiries also honor goal-based early exits (REQ-05). The wrapper
// delegates to enqueueNextStep when no goal matches.
import { advanceWithGoalCheck } from "../lib/advance-with-goal-check.js";
// Stage 4: untag wait-step job from its step's SET on completion / no-op skip.
// Pause endpoint (Stage 4 T6) reads this SET to enumerate jobs to cancel.
import { untagJob } from "../lib/step-job-tagging.js";

export interface ProcessStepJobData {
  enrollmentId: string;
  stepId: string;
}

export function createProcessStepWorker() {
  return new Worker<ProcessStepJobData>(
    "step-execution",
    async (job) => {
      const db = getDb();
      const { enrollmentId, stepId } = job.data;
      const jobId = typeof job.id === "string" ? job.id : `step-execution:${enrollmentId}:${stepId}`;
      // Stage 4: regardless of outcome below (advance / skip), the BullMQ job
      // is consumed — untag so the step's SET reflects in-flight reality.
      const cleanupTag = () =>
        untagJob(stepId, jobId).catch((err) =>
          logger.warn({ err, stepId, jobId }, "untagJob failed in process-step (non-fatal)"),
        );

      // 1. Load enrollment.
      const [enrollment] = await db
        .select()
        .from(campaignEnrollments)
        .where(eq(campaignEnrollments.id, enrollmentId))
        .limit(1);

      if (!enrollment) {
        logger.info(
          { enrollmentId, stepId, jobId: job.id },
          "process-step: enrollment not found, skipping (likely cascade-deleted)",
        );
        await cleanupTag();
        return;
      }

      // 2. Status check.
      if (enrollment.status !== "active") {
        logger.info(
          { enrollmentId, stepId, status: enrollment.status, jobId: job.id },
          "process-step: enrollment not active, skipping (likely cancelled/paused)",
        );
        await cleanupTag();
        return;
      }

      // 3. Pointer check — the delayed job may be stale if the enrollment
      // moved on (e.g. user reset/restarted the enrollment).
      if (enrollment.currentStepId !== stepId) {
        logger.warn(
          {
            enrollmentId,
            expectedStepId: stepId,
            currentStepId: enrollment.currentStepId,
            jobId: job.id,
          },
          "process-step: stale delayed job (enrollment moved on), skipping",
        );
        await cleanupTag();
        return;
      }

      // 4. Verify step still exists (campaign deleted with cascade race).
      const [step] = await db
        .select()
        .from(campaignSteps)
        .where(eq(campaignSteps.id, stepId))
        .limit(1);

      if (!step) {
        logger.info(
          { enrollmentId, stepId, jobId: job.id },
          "process-step: step row missing, skipping",
        );
        await cleanupTag();
        return;
      }

      // Valid: wait elapsed. Stage 5: route through the goal-aware wrapper —
      // if a goal already matches this contact, the enrollment exits via
      // `goal_achieved` instead of advancing.
      await advanceWithGoalCheck({
        enrollmentId,
        completedPosition: step.position,
      });
      await cleanupTag();

      logger.info(
        { enrollmentId, stepId, completedPosition: step.position, jobId: job.id },
        "process-step: wait elapsed, enrollment advanced",
      );
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: 20,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  );
}
