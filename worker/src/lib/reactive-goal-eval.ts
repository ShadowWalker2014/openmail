/**
 * Reactive goal evaluation (Stage 5 — T8, REQ-06).
 *
 * Triggered when an event arrives for a contact: re-evaluate every ACTIVE
 * enrollment of that contact across the workspace, in case the event
 * satisfies a goal on a campaign that the contact is currently enrolled in
 * (different from the campaign that just enrolled them, which is handled in
 * the proactive path of `advanceWithGoalCheck`).
 *
 * On no-match: do NOTHING. The enrollment stays where it is — reactive eval
 * does not drive forward progression (proactive paths do that). On match:
 * perform the same cancel-BullMQ-first → DB-tx → audit-pair dance as
 * `advanceWithGoalCheck`.
 *
 * Skip rules:
 *  - Enrollments in stopping/stopped/archived campaigns ([A5.4]).
 *  - Enrollments with `forceExitedAt IS NOT NULL` (CR-13).
 *  - Enrollments whose status is not `active`.
 *
 * Performance:
 *  - Workspace + contactId index on `campaign_enrollments(campaign_id,
 *    contact_id)` filters the candidate set quickly.
 *  - `getCachedGoals(campaignId)` is hit-mostly after warm-up; cold path is
 *    one query per distinct campaign id.
 *
 * Error policy:
 *  - Per-enrollment try/catch — one bad enrollment does not poison the rest.
 *  - Caller (`process-event.ts`) wraps the whole call in another try/catch so
 *    primary event-write work is never blocked.
 */
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import { campaignEnrollments, campaigns } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { logger } from "./logger.js";
import {
  evaluateGoals,
  loadEvaluatorContact,
  type EvaluatorTriggerEvent,
} from "./goal-evaluator.js";
import { getCachedGoals } from "./goal-cache.js";
import { audit } from "./lifecycle-audit.js";
import { cancelEnrollmentJob } from "./step-advance.js";

interface EvaluateReactiveGoalsArgs {
  workspaceId: string;
  contactId: string;
  triggeringEvent: EvaluatorTriggerEvent;
  /** Operation id propagated from the parent job for audit correlation. */
  lifecycleOpId: string;
}

/** [A5.4] — campaign statuses that suppress reactive goal evaluation. */
const SUPPRESSED_STATUSES = new Set(["stopping", "stopped", "archived"]);

export async function evaluateReactiveGoals(
  args: EvaluateReactiveGoalsArgs,
): Promise<void> {
  const db = getDb();

  // Find every active enrollment for this contact in this workspace.
  const enrollmentsForContact = await db
    .select({
      id: campaignEnrollments.id,
      campaignId: campaignEnrollments.campaignId,
      currentStepId: campaignEnrollments.currentStepId,
      forceExitedAt: campaignEnrollments.forceExitedAt,
    })
    .from(campaignEnrollments)
    .where(
      and(
        eq(campaignEnrollments.workspaceId, args.workspaceId),
        eq(campaignEnrollments.contactId, args.contactId),
        eq(campaignEnrollments.status, "active"),
      ),
    );

  if (enrollmentsForContact.length === 0) return;

  // Pre-fetch campaign statuses for distinct campaigns. One query rather
  // than N — keeps reactive eval cheap on busy contacts.
  const distinctCampaignIds = [
    ...new Set(enrollmentsForContact.map((e) => e.campaignId)),
  ];
  const campaignRows = await db
    .select({ id: campaigns.id, status: campaigns.status })
    .from(campaigns)
    .where(inArray(campaigns.id, distinctCampaignIds));
  const campaignStatusById = new Map(campaignRows.map((c) => [c.id, c.status]));

  for (const enrollment of enrollmentsForContact) {
    if (enrollment.forceExitedAt !== null) continue; // CR-13

    const status = campaignStatusById.get(enrollment.campaignId);
    if (!status) continue; // campaign deleted under us — let cascade handle it
    if (SUPPRESSED_STATUSES.has(status)) continue; // [A5.4]

    try {
      await reactiveEvaluateOne({
        enrollmentId: enrollment.id,
        triggeringEvent: args.triggeringEvent,
        lifecycleOpId: args.lifecycleOpId,
      });
    } catch (err) {
      logger.warn(
        {
          err,
          enrollmentId: enrollment.id,
          campaignId: enrollment.campaignId,
        },
        "reactive goal eval: per-enrollment error (non-fatal)",
      );
    }
  }
}

interface ReactiveEvaluateOneArgs {
  enrollmentId: string;
  triggeringEvent: EvaluatorTriggerEvent;
  lifecycleOpId: string;
}

async function reactiveEvaluateOne(
  args: ReactiveEvaluateOneArgs,
): Promise<void> {
  const db = getDb();
  const [enrollment] = await db
    .select()
    .from(campaignEnrollments)
    .where(eq(campaignEnrollments.id, args.enrollmentId))
    .limit(1);

  if (!enrollment || enrollment.status !== "active") return;
  if (enrollment.forceExitedAt !== null) return; // CR-13

  const goals = await getCachedGoals(enrollment.campaignId);
  if (goals.length === 0) return;

  const contact = await loadEvaluatorContact(enrollment.contactId);
  if (!contact) return;

  const result = await evaluateGoals(
    {
      id: enrollment.id,
      campaignId: enrollment.campaignId,
      contactId: enrollment.contactId,
      workspaceId: enrollment.workspaceId,
      startedAt: enrollment.startedAt,
      forceExitedAt: enrollment.forceExitedAt,
    },
    contact,
    goals,
    args.triggeringEvent,
  );

  // Surface evaluator errors but don't block (CR-06).
  if (result.evaluationError) {
    try {
      await audit.emit(enrollment.id, "goal_evaluation_error", {
        campaignId: enrollment.campaignId,
        workspaceId: enrollment.workspaceId,
        contactId: enrollment.contactId,
        actor: { kind: "system" },
        payload: {
          lifecycle_op_id: args.lifecycleOpId,
          goal_id: result.evaluationError.goalId,
          error_message: result.evaluationError.message,
          path: "reactive",
        },
      });
    } catch (err) {
      logger.warn({ err }, "reactive: goal_evaluation_error emit failed");
    }
  }

  if (!result.achieved || !result.goalId) return; // No-match → leave alone.

  // CR-12 ordering: cancel BullMQ FIRST, then DB tx.
  await cancelEnrollmentJob(enrollment.id, enrollment.currentStepId);

  const completedAt = new Date();
  // Child op_id correlates the reactive trigger to the resulting goal_achieved
  // without losing the parent event op_id.
  const reactiveOpId = generateId("lop_react");

  await db.transaction(async (tx) => {
    await tx
      .update(campaignEnrollments)
      .set({
        status: "completed",
        completedAt,
        completedViaGoalId: result.goalId,
        updatedAt: completedAt,
      })
      .where(eq(campaignEnrollments.id, enrollment.id));

    await audit.emit(
      enrollment.id,
      "goal_achieved",
      {
        campaignId: enrollment.campaignId,
        workspaceId: enrollment.workspaceId,
        contactId: enrollment.contactId,
        actor: { kind: "system" },
        payload: {
          lifecycle_op_id: reactiveOpId,
          parent_lifecycle_op_id: args.lifecycleOpId,
          goal_id: result.goalId,
          match_type: result.matchType,
          match_payload: result.matchPayload ?? null,
          triggered_reactive: true,
          triggering_event: {
            name: args.triggeringEvent.name,
            occurred_at: args.triggeringEvent.occurredAt.toISOString(),
          },
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
        actor: { kind: "system" },
        payload: {
          lifecycle_op_id: reactiveOpId,
          via: "goal",
          goal_id: result.goalId,
        },
      },
      tx,
    );
  });

  logger.info(
    {
      enrollmentId: enrollment.id,
      goalId: result.goalId,
      eventName: args.triggeringEvent.name,
      lifecycle_op_id: reactiveOpId,
      parent_lifecycle_op_id: args.lifecycleOpId,
    },
    "reactive: goal achieved → enrollment completed",
  );
}
