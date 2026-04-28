/**
 * process-step worker
 *
 * Consumes the `step-execution` queue. A delayed job here represents a
 * `wait` step whose timer has elapsed — the wait is complete, advance to
 * the next step.
 *
 * Idempotency (validator-mandated):
 *   - If enrollment.status !== "active" — the enrollment was cancelled/paused/
 *     completed between scheduling and now. Return cleanly (do NOT throw —
 *     this is not a retryable condition).
 *   - If enrollment.currentStepId !== job.stepId — the cursor moved. Same.
 *   - If the step itself was deleted (campaign cascade race) — same.
 *
 * Errors that DO throw → BullMQ retries with exponential backoff:
 *   - DB connectivity loss
 *   - Queue connectivity loss (inside enqueueNextStep)
 */

import { Worker } from "bullmq";
import { getWorkerRedisConnection } from "../lib/redis.js";
import { getDb } from "@openmail/shared/db";
import { campaignEnrollments, campaignSteps } from "@openmail/shared/schema";
import { eq } from "drizzle-orm";
import { enqueueNextStep } from "../lib/step-advance.js";
import { logger } from "../lib/logger.js";

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

      // 1. Load enrollment.
      const [enrollment] = await db
        .select()
        .from(campaignEnrollments)
        .where(eq(campaignEnrollments.id, enrollmentId))
        .limit(1);

      if (!enrollment) {
        logger.info({ enrollmentId, stepId }, "process-step: enrollment not found, skipping");
        return;
      }

      // 2. Idempotency: enrollment must be active.
      if (enrollment.status !== "active") {
        logger.info(
          { enrollmentId, status: enrollment.status, stepId },
          "process-step: enrollment not active, skipping (cancelled/paused/completed during wait)",
        );
        return;
      }

      // 3. Idempotency: cursor must still point at this step.
      if (enrollment.currentStepId !== stepId) {
        logger.warn(
          { enrollmentId, expectedStepId: stepId, actualStepId: enrollment.currentStepId },
          "process-step: stale delayed job (cursor moved), skipping",
        );
        return;
      }

      // 4. Load step (verify it still exists).
      const [step] = await db
        .select()
        .from(campaignSteps)
        .where(eq(campaignSteps.id, stepId))
        .limit(1);

      if (!step) {
        logger.warn(
          { enrollmentId, stepId },
          "process-step: step not found (campaign deleted?), skipping",
        );
        return;
      }

      // 5. Wait has elapsed — advance.
      await enqueueNextStep(enrollmentId, step.position);
      logger.info(
        { enrollmentId, stepId, completedPosition: step.position },
        "process-step: wait elapsed, advanced to next step",
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
