/**
 * Advance with goal-check (Stage 5 — T7, REQ-05, CR-12).
 *
 * Wraps Stage 1's `enqueueNextStep` to inject goal evaluation into the
 * step-advance hot path WITHOUT modifying Stage 1's `step-advance.ts`.
 * Callers that previously called `enqueueNextStep(eid, pos)` should switch
 * to `advanceWithGoalCheck({...})` so goals are honored.
 *
 * Ordering invariant (CR-12 — "BullMQ-cancel-before-DB"):
 *   1. Load campaign goals (cache hit usually).
 *   2. Run `evaluateGoals(...)`.
 *   3. If achieved:
 *        a. Cancel the pending step-execution job for this enrollment FIRST
 *           (mirrors Stage 1 T7 cancellation pattern).
 *        b. THEN open a DB transaction:
 *             - UPDATE campaign_enrollments SET status='completed',
 *               completed_via_goal_id=<goal>, completed_at=now()
 *             - audit.emit("goal_achieved", ...) — per-enrollment, with
 *               match payload
 *             - audit.emit("enrollment_completed", { via: "goal" }) — paired
 *               causal event per CR-08
 *      Returns `{achieved: true, advanced: false, goalId}` so caller skips
 *      the normal advance.
 *   4. Else: invoke Stage 1's `enqueueNextStep` and return
 *      `{achieved: false, advanced: true}`.
 *
 * Error handling (CR-06):
 *   - If `evaluateGoals` reports `evaluationError`, emit a single
 *     `goal_evaluation_error` audit event and CONTINUE with the normal
 *     advance (graceful degrade — better to over-send than to strand).
 *   - DB / Redis errors propagate to BullMQ for retry (caller's job context).
 *
 * Skip conditions:
 *   - Enrollment not found → log + return without advance (let Stage 1
 *     enqueueNextStep handle this defensively too).
 *   - Enrollment not active → return without advance.
 *   - Campaign in stopping/stopped/archived → don't evaluate goals
 *     ([A5.4]) — let drain sweeper handle terminal cleanup.
 *
 * No call sites pass an explicit `lifecycle_op_id` yet — we generate one
 * with prefix `lop_goal_` matching the [V2.5] correlation id convention.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import {
  campaignEnrollments,
  campaigns,
} from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { logger } from "./logger.js";
import { enqueueNextStep, cancelEnrollmentJob } from "./step-advance.js";
import {
  evaluateGoals,
  loadEvaluatorContact,
  type EvaluatorEnrollment,
  type EvaluatorTriggerEvent,
} from "./goal-evaluator.js";
import { getCachedGoals } from "./goal-cache.js";
import { audit, type Actor } from "./lifecycle-audit.js";

export interface AdvanceWithGoalCheckArgs {
  enrollmentId: string;
  /** Position passed through to `enqueueNextStep` when no goal matches. */
  completedPosition: number;
  /**
   * Optional triggering event (Task 8 reactive path). When present, event-type
   * goals consult this event directly instead of querying the events table.
   */
  triggeringEvent?: EvaluatorTriggerEvent;
  /** Defaults to `{kind: "system"}`. */
  actor?: Actor;
  /** Operation correlation id; generated when absent (`lop_goal_*`). */
  lifecycleOpId?: string;
}

export interface AdvanceWithGoalCheckResult {
  achieved: boolean;
  /** True when goal_achieved did NOT fire and we delegated to Stage 1. */
  advanced: boolean;
  goalId?: string;
}

/**
 * Campaign statuses that suppress goal evaluation per [A5.4]. The drain
 * sweeper / archived state is the canonical owner of these enrollments.
 */
const GOAL_SUPPRESSED_CAMPAIGN_STATUSES: ReadonlyArray<string> = [
  "stopping",
  "stopped",
  "archived",
];

export async function advanceWithGoalCheck(
  args: AdvanceWithGoalCheckArgs,
): Promise<AdvanceWithGoalCheckResult> {
  const {
    enrollmentId,
    completedPosition,
    triggeringEvent,
    actor = { kind: "system" } as const,
  } = args;
  const lifecycleOpId = args.lifecycleOpId ?? generateId("lop_goal");
  const db = getDb();
  const log = logger.child({ lifecycle_op_id: lifecycleOpId, enrollmentId });

  // 1. Load enrollment (single point of truth for status + force_exit + scope).
  const [enrollment] = await db
    .select()
    .from(campaignEnrollments)
    .where(eq(campaignEnrollments.id, enrollmentId))
    .limit(1);

  if (!enrollment) {
    log.info("advanceWithGoalCheck: enrollment not found, skipping");
    return { achieved: false, advanced: false };
  }
  if (enrollment.status !== "active") {
    log.info(
      { status: enrollment.status },
      "advanceWithGoalCheck: enrollment not active, skipping",
    );
    return { achieved: false, advanced: false };
  }

  // 2. Load campaign — gate on terminal statuses ([A5.4]).
  const [campaign] = await db
    .select({ id: campaigns.id, status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, enrollment.campaignId))
    .limit(1);

  if (!campaign) {
    log.warn("advanceWithGoalCheck: campaign not found");
    return { achieved: false, advanced: false };
  }

  if (GOAL_SUPPRESSED_CAMPAIGN_STATUSES.includes(campaign.status)) {
    log.info(
      { campaignStatus: campaign.status },
      "advanceWithGoalCheck: campaign in terminal status, skipping goal eval and advance",
    );
    return { achieved: false, advanced: false };
  }

  // 3. Load goals (cache hit usually).
  const goals = await getCachedGoals(enrollment.campaignId);

  // No goals — go straight to Stage 1 advance.
  if (goals.length === 0) {
    await enqueueNextStep(enrollmentId, completedPosition);
    return { achieved: false, advanced: true };
  }

  // 4. Load contact for evaluator (CN-04 — single-row read).
  const contact = await loadEvaluatorContact(enrollment.contactId);
  if (!contact) {
    // Contact gone — let Stage 1 advance handle (it'll mark completed).
    await enqueueNextStep(enrollmentId, completedPosition);
    return { achieved: false, advanced: true };
  }

  const evaluatorEnrollment: EvaluatorEnrollment = {
    id: enrollment.id,
    campaignId: enrollment.campaignId,
    contactId: enrollment.contactId,
    workspaceId: enrollment.workspaceId,
    startedAt: enrollment.startedAt,
    forceExitedAt: enrollment.forceExitedAt,
  };

  // 5. Evaluate.
  const result = await evaluateGoals(
    evaluatorEnrollment,
    contact,
    goals,
    triggeringEvent,
  );

  // 5a. Surface evaluator errors (CR-06) — do NOT block advance.
  if (result.evaluationError) {
    try {
      await audit.emit(enrollment.id, "goal_evaluation_error", {
        campaignId: enrollment.campaignId,
        workspaceId: enrollment.workspaceId,
        contactId: enrollment.contactId,
        actor,
        payload: {
          lifecycle_op_id: lifecycleOpId,
          goal_id: result.evaluationError.goalId,
          error_message: result.evaluationError.message,
        },
      });
    } catch (err) {
      log.warn({ err }, "goal_evaluation_error audit emit failed (non-fatal)");
    }
  }

  // 6. No achievement — delegate to Stage 1.
  if (!result.achieved || !result.goalId) {
    await enqueueNextStep(enrollmentId, completedPosition);
    return { achieved: false, advanced: true };
  }

  // 7. ACHIEVED. CR-12 ordering: cancel BullMQ FIRST, then DB tx.
  await cancelEnrollmentJob(enrollmentId, enrollment.currentStepId);

  const completedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(campaignEnrollments)
      .set({
        status: "completed",
        completedAt,
        completedViaGoalId: result.goalId,
        updatedAt: completedAt,
      })
      .where(eq(campaignEnrollments.id, enrollmentId));

    await audit.emit(
      enrollment.id,
      "goal_achieved",
      {
        campaignId: enrollment.campaignId,
        workspaceId: enrollment.workspaceId,
        contactId: enrollment.contactId,
        actor,
        payload: {
          lifecycle_op_id: lifecycleOpId,
          goal_id: result.goalId,
          match_type: result.matchType,
          match_payload: result.matchPayload ?? null,
          triggered_reactive: triggeringEvent !== undefined,
        },
        before: { status: "active", completed_via_goal_id: null },
        after: { status: "completed", completed_via_goal_id: result.goalId },
      },
      tx,
    );

    await audit.emit(
      enrollment.id,
      "enrollment_completed",
      {
        campaignId: enrollment.campaignId,
        workspaceId: enrollment.workspaceId,
        contactId: enrollment.contactId,
        actor,
        payload: {
          lifecycle_op_id: lifecycleOpId,
          via: "goal",
          goal_id: result.goalId,
        },
      },
      tx,
    );
  });

  log.info(
    { goalId: result.goalId, matchType: result.matchType },
    "advanceWithGoalCheck: goal achieved → enrollment completed",
  );

  return { achieved: true, advanced: false, goalId: result.goalId };
}
