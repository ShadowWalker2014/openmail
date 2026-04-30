/**
 * Stage 4 (CR-07, REQ-16) + Stage 6 reuse [DB-06].
 *
 * Helper to advance held enrollments past a deleted/edited step. Called from
 * the campaign step DELETE handler when the deleted step is paused AND has
 * held enrollments. For each held enrollment:
 *   - Emit `reconciled` audit event with reason
 *   - Call Stage 1's `enqueueNextStep(enrollmentId, deletedStepPosition)` so
 *     the engine advances past the deleted position
 *   - Clear `step_held_at` on the enrollment row
 *
 * Idempotent: enrollment whose step_held_at IS NULL is skipped (the engine
 * already moved them on a previous reconciliation run, or they were never
 * held).
 */
import { eq, and, isNotNull } from "drizzle-orm";
import { campaignEnrollments } from "@openmail/shared/schema";
import type { AuditTx, Actor } from "./lifecycle-audit.js";
import { audit } from "./lifecycle-audit.js";
import { enqueueNextStep } from "./step-advance.js";
import { logger } from "./logger.js";

export interface AdvancePastStepOpts {
  campaignId: string;
  workspaceId: string;
  stepId: string;
  /**
   * Position of the deleted step. Held enrollments are advanced via
   * `enqueueNextStep(enrollmentId, deletedStepPosition)` so the engine picks
   * the NEXT step (position > deletedStepPosition).
   */
  deletedStepPosition: number;
  lifecycleOpId: string;
  actor: Actor;
  /** Why we're advancing — populates `reconciled` event payload. */
  reason: "step_deleted_while_paused" | "step_edited_while_paused" | "manual_reconciliation";
}

export interface AdvancePastStepResult {
  /** Held enrollments that were advanced. */
  advanced: Array<{ enrollmentId: string; contactId: string }>;
}

/**
 * Read held enrollments + emit reconciled events INSIDE the caller's tx,
 * then perform the (non-tx) `enqueueNextStep` calls and `step_held_at` clear
 * AFTER the tx commits. We split because:
 *   - Audit events MUST live in the same atomic boundary as the step deletion
 *     (CR-01).
 *   - `enqueueNextStep` enqueues BullMQ (side-effect outside DB) and runs its
 *     own internal SELECT/UPDATE/INSERT — composing it inside the caller's tx
 *     would risk holding the tx open across a Redis call.
 *
 * This helper returns the held set inside the tx; callers call the second
 * helper `advanceEnrollmentsPastStepAfterCommit` after `tx` resolves.
 */
export async function readAndAuditHeldEnrollmentsForStep(
  tx: AuditTx,
  opts: AdvancePastStepOpts,
): Promise<AdvancePastStepResult> {
  const heldRows = (await tx
    .select({
      id: campaignEnrollments.id,
      contactId: campaignEnrollments.contactId,
    })
    .from(campaignEnrollments)
    .where(
      and(
        eq(campaignEnrollments.currentStepId, opts.stepId),
        eq(campaignEnrollments.status, "active"),
        isNotNull(campaignEnrollments.stepHeldAt),
      ),
    )) as Array<{ id: string; contactId: string }>;

  for (const r of heldRows) {
    await audit.emit(
      r.id,
      "reconciled",
      {
        campaignId: opts.campaignId,
        workspaceId: opts.workspaceId,
        contactId: r.contactId,
        actor: opts.actor,
        payload: {
          lifecycle_op_id: opts.lifecycleOpId,
          step_id: opts.stepId,
          deleted_step_position: opts.deletedStepPosition,
          reason: opts.reason,
        },
        before: { current_step_id: opts.stepId, step_held_at: "set" },
        after: { current_step_id: "advanced", step_held_at: null },
      },
      tx,
    );
  }

  return {
    advanced: heldRows.map((r) => ({
      enrollmentId: r.id,
      contactId: r.contactId,
    })),
  };
}

/**
 * After the caller's tx commits, advance each held enrollment past the
 * deleted step. Calls Stage 1 `enqueueNextStep` per enrollment + clears the
 * `step_held_at` on success. Failures are logged + counted but do not throw —
 * the held enrollment will be retried by the next reconciliation run.
 */
export async function advanceEnrollmentsPastStepAfterCommit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  result: AdvancePastStepResult,
  opts: AdvancePastStepOpts,
): Promise<{ advanced: number; failed: number }> {
  let advanced = 0;
  let failed = 0;
  for (const r of result.advanced) {
    try {
      await enqueueNextStep(r.enrollmentId, opts.deletedStepPosition);
      // Clear held flag.
      // We use raw db here (not a tx) because each enrollment is independently
      // advanced; failures on one shouldn't roll back others.
      await db
        .update(campaignEnrollments)
        .set({ stepHeldAt: null })
        .where(eq(campaignEnrollments.id, r.enrollmentId));
      advanced++;
    } catch (err) {
      logger.warn(
        {
          err: (err as Error).message,
          enrollmentId: r.enrollmentId,
          stepId: opts.stepId,
          lifecycle_op_id: opts.lifecycleOpId,
        },
        "advance-enrollments-past-step: enqueueNextStep failed (will retry next sweep)",
      );
      failed++;
    }
  }
  return { advanced, failed };
}
