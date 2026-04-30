/**
 * Stale-skip library (Stage 3 — T4, REQ-07, CR-04, CR-09, CR-10).
 *
 * Helpers for the "skip stale" branch of resume modes. An enrollment is
 * "stale" iff its `next_run_at` (or `scheduled_at`) is older than the
 * workspace's stale threshold.
 *
 * On stale-skip, an enrollment is NOT cancelled. Per CR-04 it ADVANCES to
 * the next step (or auto-completes if at the last step). The enrollment
 * keeps moving forward — Customer.io / Mailchimp behaviour — but the
 * specific message that was overdue is dropped.
 *
 * Audit ordering per CR-09: emit `stale_skipped` event BEFORE advancing
 * the enrollment. Replay of the audit log will then show:
 *
 *   1. paused        (Stage 2)
 *   2. resumed       (Stage 3 aggregate)
 *   3. stale_skipped (per-enrollment, with reason)
 *   4. step_advanced OR completed (auto-advance from enqueueNextStep)
 *
 * Re-uses Stage 1's `enqueueNextStep` API to advance — does NOT touch
 * step-advance internals (constraint).
 */

import { sql } from "drizzle-orm";
import type { AuditTx } from "./lifecycle-audit.js";
import { audit } from "./lifecycle-audit.js";
import { logger } from "./logger.js";
import { enqueueNextStep } from "./step-advance.js";

/**
 * Pure helper — true if `scheduledAt` is older than `thresholdSeconds` ago.
 * Treats null/undefined as NOT stale (defensive — a missing timestamp can't
 * be "old").
 */
export function isStale(
  scheduledAt: Date | string | null | undefined,
  thresholdSeconds: number,
  now: Date = new Date(),
): boolean {
  if (!scheduledAt) return false;
  const d = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return false;
  const ageSeconds = (now.getTime() - d.getTime()) / 1000;
  return ageSeconds > thresholdSeconds;
}

export interface AdvanceStaleArgs {
  enrollmentId: string;
  campaignId: string;
  workspaceId: string;
  contactId: string;
  /** Position completed from caller's perspective (current step's position). */
  currentPosition: number;
  /** lifecycle_op_id propagated from the resume operation boundary (CR-15). */
  lifecycleOpId: string;
  /** Original scheduled_at for audit reconstruction. */
  scheduledAt: Date | null;
  /** Workspace stale threshold for audit transparency. */
  thresholdSeconds: number;
}

/**
 * Mark an enrollment stale-skipped + emit audit + advance.
 *
 * Sequence (CR-09):
 *   1. UPDATE campaign_enrollments SET stale_skipped_at = NOW().
 *   2. audit.emit("stale_skipped", { reason: "scheduled_at older than threshold" }).
 *   3. enqueueNextStep(enrollmentId, currentPosition) — Stage 1 helper.
 *
 * Steps 1–2 happen inside the caller's tx (atomic). Step 3 happens AFTER
 * the tx commits because `enqueueNextStep` itself opens its own tx + does
 * BullMQ enqueue. This is intentional: BullMQ side-effects must NEVER live
 * inside an external tx (would invert the enqueue-first ordering principle
 * Stage 1 carefully established in step-advance.ts).
 *
 * Caller is responsible for opening/closing the tx around steps 1–2.
 */
export async function advanceStaleEnrollment(
  args: AdvanceStaleArgs,
  tx: AuditTx,
): Promise<void> {
  const start = Date.now();

  // Step 1: Mark stale_skipped_at.
  await tx.execute(sql`
    UPDATE campaign_enrollments
       SET stale_skipped_at = NOW(),
           updated_at       = NOW()
     WHERE id = ${args.enrollmentId}
  `);

  // Step 2: Audit BEFORE advance (CR-09).
  await audit.emit(
    args.enrollmentId,
    "stale_skipped",
    {
      campaignId: args.campaignId,
      workspaceId: args.workspaceId,
      contactId: args.contactId,
      actor: { kind: "system" },
      payload: {
        lifecycle_op_id: args.lifecycleOpId,
        reason: "scheduled_at_older_than_stale_threshold",
        threshold_seconds: args.thresholdSeconds,
        scheduled_at: args.scheduledAt
          ? args.scheduledAt.toISOString()
          : null,
      },
    },
    tx,
  );

  logger.info(
    {
      enrollmentId: args.enrollmentId,
      campaignId: args.campaignId,
      thresholdSeconds: args.thresholdSeconds,
      scheduledAt: args.scheduledAt?.toISOString() ?? null,
      lifecycle_op_id: args.lifecycleOpId,
      durationMs: Date.now() - start,
    },
    "stale-skip: marked + audited",
  );
}

/**
 * After-tx step: invoke Stage 1's enqueueNextStep to advance the enrollment.
 * Caller MUST ensure the tx that ran `advanceStaleEnrollment` has committed
 * before calling this — Stage 1's helper opens its own tx and assumes
 * `campaign_enrollments` reflects the persisted state.
 */
export async function advanceStaleEnrollmentAfterCommit(args: {
  enrollmentId: string;
  currentPosition: number;
}): Promise<void> {
  await enqueueNextStep(args.enrollmentId, args.currentPosition);
}
