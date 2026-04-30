/**
 * Stage 6 (UI follow-up) — `useReplayState` hook.
 *
 * Time-travel debugging primitive: given the chronologically-sorted events
 * for one enrollment and a "scrub" position N, compute the reconstructed
 * `ReplayState` AFTER applying the first N events.
 *
 * Reuses the same pure-function dispatcher (`scripts/lib/replay-event-dispatch`)
 * the CLI tool uses, so what the operator sees in the UI is BIT-EXACTLY what
 * `bun run scripts/replay-enrollment.ts` would produce. No drift between
 * forensics tools.
 *
 * Browser-safe: `replay-event-dispatch.ts` and `replay-state-model.ts` import
 * from `@openmail/shared/lifecycle-events*` leaf submodules (pure data + Zod),
 * never the barrel that pulls in postgres-js.
 */
import { useMemo } from "react";
import { applyEvent } from "../../../scripts/lib/replay-event-dispatch";
import {
  emptyState,
  type EventRow,
  type ReplayState,
} from "../../../worker/src/lib/replay-state-model";
import type { EnrollmentEventRow } from "./use-enrollment-events";

// Re-export so consumers (routes, components) don't have to navigate the
// monorepo with relative paths.
export { applyEvent, emptyState };
export type { EventRow, ReplayState };

/**
 * Convert an `EnrollmentEventRow` (from ElectricSQL shape, JSON-friendly) to
 * the `EventRow` shape the dispatcher expects (Date objects, BigInt seq).
 *
 * Exported so consumers (e.g. the time-travel "before" reconstruction in
 * the route) can build dispatcher inputs without knowing the relative path
 * to scripts/lib/replay-event-dispatch.
 */
export function toEventRow(r: EnrollmentEventRow): EventRow {
  return {
    id: r.id,
    enrollmentId: r.enrollment_id,
    campaignId: r.campaign_id,
    contactId: r.contact_id,
    workspaceId: r.workspace_id,
    eventType: r.event_type as EventRow["eventType"],
    payloadVersion: r.payload_version,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    before: r.before,
    after: r.after,
    eventSeq: r.event_seq != null ? BigInt(r.event_seq) : null,
    emittedAt: new Date(r.emitted_at),
  };
}

export interface ReplayResult {
  /** State AFTER applying `events[0..untilIndex]` (inclusive). */
  state: ReplayState;
  /** Events applied so far. Same elements as `chronological.slice(0, untilIndex+1)`. */
  applied: EnrollmentEventRow[];
  /** Events still ahead of the current scrub position. */
  remaining: EnrollmentEventRow[];
  /** Most recent event applied (or null if `untilIndex < 0`). */
  current: EnrollmentEventRow | null;
}

/**
 * Replay events up to (and including) `untilIndex`. Pass -1 to start from
 * empty state (before any event was applied).
 *
 * Memoized on `(chronological, untilIndex)`. Folding 10k events is sub-100ms
 * (verified by Perf 2), so we recompute on every scrub tick rather than
 * caching incremental snapshots.
 */
export function useReplayState(
  chronological: EnrollmentEventRow[],
  untilIndex: number,
): ReplayResult {
  return useMemo(() => {
    if (chronological.length === 0) {
      return {
        state: emptyState({ enrollmentId: "" }),
        applied: [],
        remaining: [],
        current: null,
      };
    }
    const first = chronological[0];
    const clampedIndex = Math.min(
      Math.max(-1, untilIndex),
      chronological.length - 1,
    );
    let state = emptyState({
      enrollmentId: first.enrollment_id ?? "",
      campaignId: first.campaign_id,
      workspaceId: first.workspace_id,
    });
    const upTo = clampedIndex + 1;
    for (let i = 0; i < upTo; i++) {
      state = applyEvent(state, toEventRow(chronological[i]));
    }
    return {
      state,
      applied: chronological.slice(0, upTo),
      remaining: chronological.slice(upTo),
      current: clampedIndex >= 0 ? chronological[clampedIndex] : null,
    };
  }, [chronological, untilIndex]);
}
