/**
 * Stage 6 — Replay state model (REQ-13, REQ-14, [A6.6], CR-04, CR-18).
 *
 * Pure-function `applyEvent(state, event)` reconstructs the final state of a
 * single enrollment by sequentially applying every event in
 * `enrollment_events` (and optionally `enrollment_events_archive`) ordered by
 * `(enrollment_id, event_seq)` (NOT `emitted_at` — clock skew unsafe; see
 * Stage 2 [A2.3]).
 *
 * Drift detection: the CLI replay tool compares the replayed state to the
 * current `campaign_enrollments` row. Any field mismatch = drift.
 *
 * NOT in this file (separation of concerns):
 *   - `scripts/lib/replay-event-dispatch.ts` — exhaustive switch on
 *     `(event_type, payload_version)` tuple with TS `never` check (CR-04).
 *   - `scripts/replay-enrollment.ts` — CLI tool that loads events + drives
 *     `applyEvent` + diffs.
 */
// Leaf submodule import — keeps this file browser-safe (the @openmail/shared
// barrel re-exports DB client code that pulls in postgres-js).
import type { EnrollmentEventType } from "@openmail/shared/lifecycle-events";

// ─── Types ───────────────────────────────────────────────────────────────────

export type EnrollmentStatus =
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed"
  | "unknown";

/**
 * Per-enrollment state reconstructed from event log. Mirrors the relevant
 * subset of `campaign_enrollments` columns the replay tool diffs.
 */
export interface ReplayState {
  enrollmentId: string;
  campaignId: string;
  workspaceId: string;
  contactId: string | null;
  status: EnrollmentStatus;
  currentStepId: string | null;
  stepEnteredAt: Date | null;
  nextRunAt: Date | null;
  pausedAt: Date | null;
  forceExitedAt: Date | null;
  staleSkippedAt: Date | null;
  completedAt: Date | null;
  completedViaGoalId: string | null;
  spreadToken: string | null;
  stepHeldAt: Date | null;
  /** Number of events successfully applied (excludes redacted/skipped). */
  eventsApplied: number;
  /**
   * Non-fatal accumulator: schema mismatch, redacted opaque events, unknown
   * (event_type, payload_version) combos. Replay reports these but does NOT
   * exit non-zero; only state-vs-current drift triggers exit 2.
   */
  warnings: string[];
}

/** Typed shape of a single event row used by the dispatcher. */
export interface EventRow {
  id: string;
  enrollmentId: string | null;
  campaignId: string;
  contactId: string | null;
  workspaceId: string;
  eventType: EnrollmentEventType;
  payloadVersion: number;
  payload: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  eventSeq: bigint | null;
  emittedAt: Date;
  /** True iff origin set in archive table. */
  fromArchive?: boolean;
}

/** Initial state with everything null/unknown. */
export function emptyState(opts: {
  enrollmentId: string;
  campaignId?: string;
  workspaceId?: string;
}): ReplayState {
  return {
    enrollmentId: opts.enrollmentId,
    campaignId: opts.campaignId ?? "",
    workspaceId: opts.workspaceId ?? "",
    contactId: null,
    status: "unknown",
    currentStepId: null,
    stepEnteredAt: null,
    nextRunAt: null,
    pausedAt: null,
    forceExitedAt: null,
    staleSkippedAt: null,
    completedAt: null,
    completedViaGoalId: null,
    spreadToken: null,
    stepHeldAt: null,
    eventsApplied: 0,
    warnings: [],
  };
}

/**
 * Compare replayed state against the live row. Returns null if equivalent,
 * otherwise an object whose keys are mismatched fields.
 */
export type DriftDiff = Partial<
  Record<keyof ReplayState, { replayed: unknown; current: unknown }>
>;

export function diffState(
  replayed: ReplayState,
  current: Partial<ReplayState>,
): DriftDiff | null {
  const fields: Array<keyof ReplayState> = [
    "status",
    "currentStepId",
    "stepEnteredAt",
    "nextRunAt",
    "pausedAt",
    "forceExitedAt",
    "staleSkippedAt",
    "completedAt",
    "completedViaGoalId",
    "spreadToken",
    "stepHeldAt",
  ];
  const diff: DriftDiff = {};
  for (const f of fields) {
    const a = replayed[f];
    const b = current[f];
    if (!equiv(a, b)) {
      diff[f] = { replayed: a, current: b };
    }
  }
  return Object.keys(diff).length === 0 ? null : diff;
}

function equiv(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  // Date vs string ISO
  if (a instanceof Date && typeof b === "string") {
    return a.toISOString() === new Date(b).toISOString();
  }
  if (b instanceof Date && typeof a === "string") {
    return b.toISOString() === new Date(a).toISOString();
  }
  return false;
}
