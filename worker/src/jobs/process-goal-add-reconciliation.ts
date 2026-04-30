/**
 * Stage 6 — Goal-add paginated reconciliation worker (REQ-10, [A6.2], CR-13).
 *
 * Triggered by edit reconciliation worker (T10) on `goal_added` edits.
 * Streams in-flight enrollments in chunks (default 1000) so a 1M-enrollment
 * campaign doesn't lock for 30+ minutes.
 *
 * Per chunk:
 *   1. Own DB transaction.
 *   2. For each enrollment: load contact + goals + run goal-evaluator.
 *   3. On match: cancel BullMQ wait job FIRST, then UPDATE enrollment to
 *      `completed_via_goal_id = X`, status=`completed`, completedAt=now()
 *      (Stage 5 [CR-12] order).
 *   4. Emit `goal_achieved` + `enrollment_completed` causal pair.
 *   5. Emit `reconciliation_chunk_progress` per chunk.
 *
 * At completion: aggregate `reconciled` event with totals.
 */
import type { Job } from "bullmq";
import { Queue, Worker } from "bullmq";
import { sql, eq, and, gt, isNull } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import {
  campaignEnrollments,
  campaignGoals,
} from "@openmail/shared/schema";
import {
  getQueueRedisConnection,
  getWorkerRedisConnection,
} from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { audit, type Actor } from "../lib/lifecycle-audit.js";
import {
  evaluateGoals,
  loadEvaluatorContact,
} from "../lib/goal-evaluator.js";
import { cancelEnrollmentJob } from "../lib/step-advance.js";

const QUEUE_NAME = "lifecycle-goal-add-reconciliation" as const;
const JOB_NAME = "goal-add-reconcile" as const;

const SWEEPER_ACTOR: Actor = { kind: "sweeper", runId: "goal-add-reconciliation" };

function getChunkSize(): number {
  const raw = process.env.LIFECYCLE_RECONCILIATION_CHUNK_SIZE;
  const n = raw ? Number.parseInt(raw, 10) : 1000;
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

export interface GoalAddJobData {
  workspaceId: string;
  campaignId: string;
  goalId: string;
  lifecycleOpId: string;
}

let _queue: Queue<GoalAddJobData> | null = null;
function getQueue(): Queue<GoalAddJobData> {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: getQueueRedisConnection() });
  }
  return _queue;
}

export async function enqueueGoalAddReconciliation(
  data: GoalAddJobData,
): Promise<void> {
  await getQueue().add(JOB_NAME, data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
  });
}

interface EnrollmentRow {
  id: string;
  campaignId: string;
  workspaceId: string;
  contactId: string;
  currentStepId: string | null;
  status: string;
  startedAt: Date | null;
  forceExitedAt: Date | null;
  completedAt: Date | null;
}

async function loadGoalsForCampaign(campaignId: string) {
  const db = getDb();
  const goals = await db
    .select()
    .from(campaignGoals)
    .where(eq(campaignGoals.campaignId, campaignId));
  return goals;
}

async function loadEnrollmentChunk(
  campaignId: string,
  cursorId: string | null,
  chunkSize: number,
): Promise<EnrollmentRow[]> {
  const db = getDb();
  const conds = [
    eq(campaignEnrollments.campaignId, campaignId),
    eq(campaignEnrollments.status, "active"),
  ];
  if (cursorId) conds.push(gt(campaignEnrollments.id, cursorId));
  const rows = (await db
    .select({
      id: campaignEnrollments.id,
      campaignId: campaignEnrollments.campaignId,
      workspaceId: campaignEnrollments.workspaceId,
      contactId: campaignEnrollments.contactId,
      currentStepId: campaignEnrollments.currentStepId,
      status: campaignEnrollments.status,
      startedAt: campaignEnrollments.startedAt,
      forceExitedAt: campaignEnrollments.forceExitedAt,
      completedAt: campaignEnrollments.completedAt,
    })
    .from(campaignEnrollments)
    .where(and(...conds))
    .orderBy(campaignEnrollments.id)
    .limit(chunkSize)) as EnrollmentRow[];
  return rows;
}

async function processChunk(
  campaignId: string,
  goalId: string,
  enrollments: EnrollmentRow[],
  lifecycleOpId: string,
): Promise<{ matched: number }> {
  const db = getDb();
  const goals = await loadGoalsForCampaign(campaignId);
  const targetGoals = goals.filter((g) => g.id === goalId && g.enabled);
  if (targetGoals.length === 0) return { matched: 0 };

  let matched = 0;
  for (const enr of enrollments) {
    if (enr.forceExitedAt) continue;
    if (enr.status !== "active") continue;
    try {
      const contact = await loadEvaluatorContact(enr.contactId);
      if (!contact) continue;
      const result = await evaluateGoals(
        {
          id: enr.id,
          campaignId: enr.campaignId,
          workspaceId: enr.workspaceId,
          contactId: enr.contactId,
          startedAt: enr.startedAt ?? new Date(),
          forceExitedAt: enr.forceExitedAt,
        },
        contact,
        targetGoals,
      );
      if (!result.achieved) continue;

      // Stage 5 [CR-12]: cancel BullMQ wait job FIRST, THEN DB update.
      await cancelEnrollmentJob(enr.id, enr.currentStepId);

      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lifecycle.audited_tx = 'true'`);
        await tx
          .update(campaignEnrollments)
          .set({
            status: "completed",
            completedAt: new Date(),
            completedViaGoalId: goalId,
            updatedAt: new Date(),
          })
          .where(eq(campaignEnrollments.id, enr.id));

        // Causal pair: goal_achieved + enrollment_completed
        await audit.emit(
          enr.id,
          "goal_achieved",
          {
            campaignId,
            workspaceId: enr.workspaceId,
            contactId: enr.contactId,
            actor: SWEEPER_ACTOR,
            payload: {
              lifecycle_op_id: lifecycleOpId,
              goal_id: goalId,
              condition_type: targetGoals[0].conditionType,
              source: "reconciliation",
            },
          },
          tx,
        );
        await audit.emit(
          enr.id,
          "enrollment_completed",
          {
            campaignId,
            workspaceId: enr.workspaceId,
            contactId: enr.contactId,
            actor: SWEEPER_ACTOR,
            payload: {
              lifecycle_op_id: lifecycleOpId,
              via: "goal",
              goal_id: goalId,
            },
            before: { status: "active" },
            after: { status: "completed" },
          },
          tx,
        );
      });
      matched++;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, enrollmentId: enr.id, goalId },
        "goal-add-reconciliation: per-enrollment failed (continuing)",
      );
    }
  }
  return { matched };
}

async function reconcileGoalAdd(data: GoalAddJobData): Promise<{
  totalProcessed: number;
  totalMatched: number;
  chunks: number;
  durationMs: number;
}> {
  const start = Date.now();
  const chunkSize = getChunkSize();
  let cursorId: string | null = null;
  let totalProcessed = 0;
  let totalMatched = 0;
  let chunkIndex = 0;

  while (true) {
    const chunk = await loadEnrollmentChunk(data.campaignId, cursorId, chunkSize);
    if (chunk.length === 0) break;
    const { matched } = await processChunk(
      data.campaignId,
      data.goalId,
      chunk,
      data.lifecycleOpId,
    );
    totalProcessed += chunk.length;
    totalMatched += matched;
    chunkIndex++;
    cursorId = chunk[chunk.length - 1].id;

    // Per-chunk progress event (campaign-aggregate).
    try {
      await audit.emit(
        null,
        "reconciliation_chunk_progress",
        {
          campaignId: data.campaignId,
          workspaceId: data.workspaceId,
          contactId: null,
          actor: SWEEPER_ACTOR,
          payload: {
            lifecycle_op_id: data.lifecycleOpId,
            edit_type: "goal_added",
            chunk_index: chunkIndex,
            matched_count: matched,
          },
        },
      );
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "goal-add-reconciliation: progress event emit failed",
      );
    }

    if (chunk.length < chunkSize) break;
  }

  // Aggregate completion `reconciled`.
  try {
    await audit.emit(
      null,
      "reconciled",
      {
        campaignId: data.campaignId,
        workspaceId: data.workspaceId,
        contactId: null,
        actor: SWEEPER_ACTOR,
        payload: {
          lifecycle_op_id: data.lifecycleOpId,
          edit_type: "goal_added",
          goal_id: data.goalId,
          total_processed: totalProcessed,
          total_matched: totalMatched,
          duration_ms: Date.now() - start,
        },
      },
    );
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "goal-add-reconciliation: completion reconciled emit failed",
    );
  }

  return {
    totalProcessed,
    totalMatched,
    chunks: chunkIndex,
    durationMs: Date.now() - start,
  };
}

export function createGoalAddReconciliationWorker(): Worker<GoalAddJobData> {
  return new Worker<GoalAddJobData>(
    QUEUE_NAME,
    async (job: Job<GoalAddJobData>) => {
      const stats = await reconcileGoalAdd(job.data);
      logger.info(
        { ...stats, ...job.data },
        "goal-add-reconciliation: complete",
      );
      return stats;
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: 1,
    },
  );
}

export async function reconcileGoalAddOnce(data: GoalAddJobData) {
  return reconcileGoalAdd(data);
}
