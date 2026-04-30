/**
 * Edit-impact computation (Stage 7 follow-up — Reconciliation preview UI).
 *
 * Given a proposed campaign edit and the current state of the database,
 * compute what would happen if the edit were applied — without writing
 * anything. Used by:
 *   - The new preview API (POST /:id/steps/:stepId/preview-edit) so the
 *     dashboard can show a "this will affect 12,847 enrollments" dialog
 *     BEFORE the operator clicks save.
 *   - The reconciliation worker, which reuses the same enrollment-set
 *     query so the preview's count matches the actual reconciliation's
 *     write set (modulo race-window changes between preview and save).
 *
 * Pure-ish: the helper hits the DB only with read queries (SELECT, no
 * locks). Same call-site can be invoked from preview AND worker without
 * side effects. The reconciliation worker still owns the WRITE path —
 * this module just answers "what would be touched, and how".
 *
 * Mode classification (`wait_duration_changed`):
 *   - `immediate`:   step_entered_at + new_delay  ≤  now()
 *                    → enrollment is retroactively due; would fire on
 *                      next worker tick (subject to rate limiter).
 *   - `spread_eligible`: number of `immediate`-class enrollments exceeds
 *                       the workspace's `resume_dialog_threshold` —
 *                       operator should consider spread mode.
 *   - `still_waiting`:  step_entered_at + new_delay  >  now()
 *                       → wait completes naturally at the new run-time.
 *   - `stale_eligible`: step_entered_at + new_delay  <  now() − stale_threshold
 *                       → operator may want to skip-stale these.
 *
 * Other edit types compute their own per-enrollment impact summary:
 *   - `step_deleted`:  enrollments currently AT the deleted step would be
 *                      advanced past it (or held at the next paused step).
 *   - `step_inserted`: 0 in-flight enrollments are affected by default
 *                      (Stage 6 [REQ-10]: new enrollments use new flow;
 *                      existing in-flight do NOT receive newly-inserted
 *                      step). The override is out of scope (per backlog
 *                      §4.3).
 *   - `email_template_changed`: 0 in-flight (already-queued sends use
 *                                old template; future sends use new).
 *   - `goal_added`:    proactive eval applies on next advance for ALL
 *                      active enrollments → "could exit" count via the
 *                      goal evaluator if cheap; for a preview this is
 *                      best-estimated by `goal_eligible: COUNT(active in campaign)`.
 *   - `goal_updated|goal_removed`: 0 in-flight reconciliation needed.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import {
  campaignEnrollments,
  campaignSteps,
  campaigns,
  workspaceLifecycleSettings,
} from "@openmail/shared/schema";
import type { CampaignEditType } from "@openmail/shared";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WaitDurationImpact {
  editType: "wait_duration_changed";
  stepId: string;
  oldDelaySeconds: number;
  newDelaySeconds: number;
  totalAffected: number;
  /** Buckets — every active enrollment at this step falls into exactly one. */
  immediate: number;
  staleEligible: number;
  stillWaiting: number;
  /** Threshold pulled from workspace settings. */
  resumeDialogThreshold: number;
  staleThresholdSeconds: number;
  /** Recommendation: which resume mode the operator should pick. */
  recommendedMode: "immediate" | "spread" | "skip_stale_spread";
  /** Sample of up to 5 affected enrollments for operator preview. */
  sampleEnrollmentIds: string[];
}

export interface StepDeletedImpact {
  editType: "step_deleted";
  stepId: string;
  totalAffected: number;
  /** How many would be force-advanced past the deleted step. */
  willAdvance: number;
  sampleEnrollmentIds: string[];
}

export interface ZeroImpact {
  editType:
    | "step_inserted"
    | "email_template_changed"
    | "goal_updated"
    | "goal_removed";
  totalAffected: 0;
  /** Human-readable explanation for the dashboard tooltip. */
  reason: string;
}

export interface GoalAddedImpact {
  editType: "goal_added";
  /** Total active enrollments in the campaign that would be re-eval'd. */
  totalAffected: number;
  /** Reconciliation runs in chunks of this size. */
  chunkSize: number;
  /** Estimated number of chunks the worker will produce. */
  estimatedChunks: number;
  /**
   * NOT a goal-match estimate (would require running the goal evaluator
   * against every contact, too expensive for a preview). The dashboard
   * displays this as "up to N enrollments may exit early" — a ceiling.
   */
  upperBoundExits: number;
}

export type EditImpact =
  | WaitDurationImpact
  | StepDeletedImpact
  | ZeroImpact
  | GoalAddedImpact;

// ─── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_DIALOG_THRESHOLD = 100;
const DEFAULT_STALE_SECONDS = 7 * 86400; // 7 days

async function loadWorkspaceThresholds(
  workspaceId: string,
): Promise<{ resumeDialogThreshold: number; staleThresholdSeconds: number }> {
  const db = getDb();
  const [row] = await db
    .select({
      resumeDialogThreshold: workspaceLifecycleSettings.resumeDialogThreshold,
      staleThresholdSeconds:
        workspaceLifecycleSettings.defaultStaleThresholdSeconds,
    })
    .from(workspaceLifecycleSettings)
    .where(eq(workspaceLifecycleSettings.workspaceId, workspaceId))
    .limit(1);
  return {
    resumeDialogThreshold: row?.resumeDialogThreshold ?? DEFAULT_DIALOG_THRESHOLD,
    staleThresholdSeconds:
      row?.staleThresholdSeconds ?? DEFAULT_STALE_SECONDS,
  };
}

function classifyByRunAt(
  enteredAt: Date | null,
  newDelaySeconds: number,
  now: Date,
  staleThresholdSeconds: number,
): "immediate" | "stale_eligible" | "still_waiting" {
  // No entry timestamp = treat as "just entered" → still waiting unless
  // delay is 0/negative (caller-bug guard).
  const base = enteredAt ?? now;
  const newRunAtMs = base.getTime() + newDelaySeconds * 1000;
  const nowMs = now.getTime();
  if (newRunAtMs > nowMs) return "still_waiting";
  // Past-due. Stale if more than threshold ago.
  if (nowMs - newRunAtMs > staleThresholdSeconds * 1000) return "stale_eligible";
  return "immediate";
}

// ─── Per-edit-type impact functions ─────────────────────────────────────────

export async function previewWaitDurationChange(args: {
  workspaceId: string;
  campaignId: string;
  stepId: string;
  oldDelaySeconds: number;
  newDelaySeconds: number;
  /** Override the default `now()` for testability. */
  now?: Date;
}): Promise<WaitDurationImpact> {
  const db = getDb();
  const now = args.now ?? new Date();
  const { resumeDialogThreshold, staleThresholdSeconds } =
    await loadWorkspaceThresholds(args.workspaceId);

  // Cap at 100k enrollments — preview must remain fast. If the affected
  // set is larger than this, the worker will paginate anyway, and the
  // dashboard message says "100k+".
  const enrollments = await db
    .select({
      id: campaignEnrollments.id,
      stepEnteredAt: campaignEnrollments.stepEnteredAt,
    })
    .from(campaignEnrollments)
    .where(
      and(
        eq(campaignEnrollments.campaignId, args.campaignId),
        eq(campaignEnrollments.currentStepId, args.stepId),
        eq(campaignEnrollments.status, "active"),
      ),
    )
    .limit(100_001);

  let immediate = 0;
  let staleEligible = 0;
  let stillWaiting = 0;
  const samples: string[] = [];
  for (const e of enrollments.slice(0, 100_000)) {
    const cls = classifyByRunAt(
      e.stepEnteredAt,
      args.newDelaySeconds,
      now,
      staleThresholdSeconds,
    );
    if (cls === "immediate") immediate++;
    else if (cls === "stale_eligible") staleEligible++;
    else stillWaiting++;
    if (samples.length < 5) samples.push(e.id);
  }
  const totalAffected = enrollments.length > 100_000
    ? immediate + staleEligible + stillWaiting // capped count, dashboard adds "+"
    : immediate + staleEligible + stillWaiting;

  // Recommendation logic:
  //   - If any stale_eligible AND any immediate → skip_stale_spread
  //   - Else if immediate exceeds dialog threshold → spread
  //   - Else → immediate
  let recommendedMode: WaitDurationImpact["recommendedMode"] = "immediate";
  if (staleEligible > 0 && immediate > 0) {
    recommendedMode = "skip_stale_spread";
  } else if (immediate > resumeDialogThreshold) {
    recommendedMode = "spread";
  }

  return {
    editType: "wait_duration_changed",
    stepId: args.stepId,
    oldDelaySeconds: args.oldDelaySeconds,
    newDelaySeconds: args.newDelaySeconds,
    totalAffected,
    immediate,
    staleEligible,
    stillWaiting,
    resumeDialogThreshold,
    staleThresholdSeconds,
    recommendedMode,
    sampleEnrollmentIds: samples,
  };
}

export async function previewStepDeleted(args: {
  workspaceId: string;
  campaignId: string;
  stepId: string;
}): Promise<StepDeletedImpact> {
  const db = getDb();
  const enrollments = await db
    .select({ id: campaignEnrollments.id })
    .from(campaignEnrollments)
    .where(
      and(
        eq(campaignEnrollments.campaignId, args.campaignId),
        eq(campaignEnrollments.currentStepId, args.stepId),
        eq(campaignEnrollments.status, "active"),
      ),
    )
    .limit(100_001);

  return {
    editType: "step_deleted",
    stepId: args.stepId,
    totalAffected: enrollments.length,
    willAdvance: enrollments.length,
    sampleEnrollmentIds: enrollments.slice(0, 5).map((e) => e.id),
  };
}

export async function previewGoalAdded(args: {
  workspaceId: string;
  campaignId: string;
}): Promise<GoalAddedImpact> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaignEnrollments)
    .where(
      and(
        eq(campaignEnrollments.campaignId, args.campaignId),
        eq(campaignEnrollments.status, "active"),
      ),
    );
  const totalAffected = row?.count ?? 0;
  const chunkSize = Number.parseInt(
    process.env.LIFECYCLE_RECONCILIATION_CHUNK_SIZE ?? "1000",
    10,
  );
  const safeChunk = Number.isFinite(chunkSize) && chunkSize > 0 ? chunkSize : 1000;
  return {
    editType: "goal_added",
    totalAffected,
    chunkSize: safeChunk,
    estimatedChunks: Math.ceil(totalAffected / safeChunk),
    upperBoundExits: totalAffected,
  };
}

export function previewZeroImpactEdit(
  editType: "step_inserted" | "email_template_changed" | "goal_updated" | "goal_removed",
): ZeroImpact {
  const reason: Record<typeof editType, string> = {
    step_inserted:
      "New enrollments use the new flow. In-flight enrollments are NOT moved into the new step (per Stage 6 [REQ-10] safe default).",
    email_template_changed:
      "Already-queued sends use the old template; future sends use the new. No in-flight reconciliation needed.",
    goal_updated:
      "Goal config changes apply on next eval cycle. No retroactive write to in-flight enrollments needed.",
    goal_removed:
      "Removed goal no longer evaluated. No retroactive write needed.",
  };
  return {
    editType,
    totalAffected: 0,
    reason: reason[editType],
  };
}

// ─── Top-level dispatcher ──────────────────────────────────────────────────

export interface PreviewRequest {
  workspaceId: string;
  campaignId: string;
  editType: CampaignEditType;
  /** edit-specific details (matches outbox `details` column). */
  details: Record<string, unknown>;
}

export async function previewEdit(req: PreviewRequest): Promise<EditImpact> {
  switch (req.editType) {
    case "wait_duration_changed":
      return previewWaitDurationChange({
        workspaceId: req.workspaceId,
        campaignId: req.campaignId,
        stepId: req.details.stepId as string,
        oldDelaySeconds: (req.details.oldDelaySeconds as number) ?? 0,
        newDelaySeconds: req.details.newDelaySeconds as number,
      });
    case "step_deleted":
      return previewStepDeleted({
        workspaceId: req.workspaceId,
        campaignId: req.campaignId,
        stepId: req.details.stepId as string,
      });
    case "goal_added":
      return previewGoalAdded({
        workspaceId: req.workspaceId,
        campaignId: req.campaignId,
      });
    case "step_inserted":
    case "email_template_changed":
    case "goal_updated":
    case "goal_removed":
      return previewZeroImpactEdit(req.editType);
    default: {
      // TS exhaustiveness check.
      const _exhaustive: never = req.editType;
      throw new Error(`previewEdit: unhandled edit type ${String(_exhaustive)}`);
    }
  }
}

/**
 * Helper: looks up a campaign's status to allow the preview API to return
 * 409 on frozen campaigns (mirrors REQ-28 frozen-status guard from the
 * actual edit handlers).
 */
export async function getCampaignStatus(
  campaignId: string,
  workspaceId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
    )
    .limit(1);
  return row?.status ?? null;
}

/**
 * Helper: fetches an existing wait step's current delay in SECONDS. Used by
 * the preview endpoint when the caller doesn't pass `oldDelaySeconds`.
 *
 * Wait-step config in OpenMail is `{duration, unit}` where unit ∈
 * {hours, days, weeks}. This helper folds that to canonical seconds,
 * mirroring the API handler at api/src/routes/campaigns.ts (PATCH step)
 * and the worker at worker/src/lib/step-advance.ts.
 */
const WAIT_UNIT_SECONDS: Record<string, number> = {
  hours: 3600,
  days: 86_400,
  weeks: 7 * 86_400,
};

export async function getWaitStepDelay(
  campaignId: string,
  stepId: string,
): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .select({
      stepType: campaignSteps.stepType,
      config: campaignSteps.config,
    })
    .from(campaignSteps)
    .where(
      and(eq(campaignSteps.campaignId, campaignId), eq(campaignSteps.id, stepId)),
    )
    .limit(1);
  if (!row || row.stepType !== "wait") return null;
  const cfg = (row.config ?? {}) as { duration?: unknown; unit?: unknown };
  const duration = typeof cfg.duration === "number" ? cfg.duration : NaN;
  const unit = typeof cfg.unit === "string" ? cfg.unit : "";
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const seconds = WAIT_UNIT_SECONDS[unit];
  if (!seconds) return null;
  return duration * seconds;
}
