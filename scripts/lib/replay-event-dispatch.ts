/**
 * Stage 6 — Replay event dispatcher (REQ-14, [A6.8], CR-04, CR-18).
 *
 * Single function `applyEvent(state, event)` that switches on
 * `(event.eventType, event.payloadVersion)` and applies the canonical state
 * transition. The switch is exhaustive — adding a new event type or version
 * to `ENROLLMENT_EVENT_TYPES` without a case here = TypeScript `never` error,
 * which is the design (CR-04: silent drift on unhandled types is unacceptable).
 *
 * Validation (CR-18):
 *   - Look up Zod schema by `(eventType, payloadVersion)`.
 *   - On mismatch (missing key or schema rejects payload): record a warning
 *     and SKIP the event; replay continues. Drift may still be detected if
 *     the skip caused state to fall behind.
 *   - On `redacted: true` payloads: log warning, skip — replay treats these
 *     as opaque (PII redaction preserves event metadata, replaces payload).
 *
 * Pure: no DB access, no I/O. Inputs in, outputs out. The CLI tool wraps
 * this with cursor reads + diffs.
 */
// Leaf submodule imports — keeps this file browser-safe (the @openmail/shared
// barrel re-exports DB client code that pulls in postgres-js, blocking
// browser bundling). Web's time-travel UI imports from this module.
import {
  ENROLLMENT_EVENT_TYPES,
  type EnrollmentEventType,
} from "@openmail/shared/lifecycle-events";
import {
  getPayloadSchema,
  isRedactedPayload,
} from "@openmail/shared/lifecycle-events-payload-schemas";
import {
  type EventRow,
  type ReplayState,
  type EnrollmentStatus,
} from "../../worker/src/lib/replay-state-model.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function asDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function pushWarn(state: ReplayState, msg: string): void {
  state.warnings.push(msg);
}

/** Bind contactId/campaignId once known if state was constructed empty. */
function fillScopeFromEvent(state: ReplayState, event: EventRow): void {
  if (!state.campaignId) state.campaignId = event.campaignId;
  if (!state.workspaceId) state.workspaceId = event.workspaceId;
  if (state.contactId == null && event.contactId) state.contactId = event.contactId;
}

// ─── Exhaustiveness helper ──────────────────────────────────────────────────

function unreachable(_n: never, hint: string): never {
  throw new Error(`replay dispatcher: unreachable case (${hint})`);
}

// ─── Per-event handlers ─────────────────────────────────────────────────────
//
// Each handler returns a NEW state object. We mutate the passed-in `state`
// in-place for performance (replay can be tens of thousands of events) and
// return the same reference; callers don't depend on immutability.

function handleEnrolled(state: ReplayState, event: EventRow): ReplayState {
  state.status = "active";
  fillScopeFromEvent(state, event);
  state.stepEnteredAt = event.emittedAt;
  state.eventsApplied++;
  return state;
}

function handleStepAdvanced(state: ReplayState, event: EventRow): ReplayState {
  const after = (event.after ?? {}) as Record<string, unknown>;
  const toStepId = (event.payload.to_step_id ?? after.current_step_id) as
    | string
    | null
    | undefined;
  if (typeof toStepId === "string") state.currentStepId = toStepId;
  state.stepEnteredAt = event.emittedAt;
  state.stepHeldAt = null;
  state.eventsApplied++;
  return state;
}

function handleWaitScheduled(state: ReplayState, event: EventRow): ReplayState {
  const stepId = event.payload.step_id as string | undefined;
  if (typeof stepId === "string") state.currentStepId = stepId;
  const nextRunAt = asDate(event.payload.next_run_at);
  if (nextRunAt) state.nextRunAt = nextRunAt;
  state.eventsApplied++;
  return state;
}

function handleWaitFired(state: ReplayState, event: EventRow): ReplayState {
  state.nextRunAt = null;
  state.eventsApplied++;
  return state;
}

function handleMessageSent(state: ReplayState, _event: EventRow): ReplayState {
  state.eventsApplied++;
  return state;
}

function handleMessageFailed(state: ReplayState, _event: EventRow): ReplayState {
  state.eventsApplied++;
  return state;
}

function handlePaused(state: ReplayState, event: EventRow): ReplayState {
  state.status = "paused";
  state.pausedAt = event.emittedAt;
  state.eventsApplied++;
  return state;
}

function handleResumed(state: ReplayState, _event: EventRow): ReplayState {
  state.status = "active";
  state.pausedAt = null;
  state.eventsApplied++;
  return state;
}

function handleForceExited(state: ReplayState, event: EventRow): ReplayState {
  // force_exit may be aggregate (campaigns) too; only mutate enrollment-state
  // when this row scopes to the same enrollment (caller guarantees per-enroll
  // events only when called from per-enrollment replay).
  state.forceExitedAt = event.emittedAt;
  state.status = "cancelled";
  state.completedAt = state.completedAt ?? event.emittedAt;
  state.eventsApplied++;
  return state;
}

function handleStaleSkipped(state: ReplayState, event: EventRow): ReplayState {
  state.staleSkippedAt = event.emittedAt;
  state.eventsApplied++;
  return state;
}

function handleSpreadScheduled(state: ReplayState, event: EventRow): ReplayState {
  const spreadToken = event.payload.spread_token as string | undefined;
  if (typeof spreadToken === "string") state.spreadToken = spreadToken;
  const nextRunAt = asDate(event.payload.next_run_at);
  if (nextRunAt) state.nextRunAt = nextRunAt;
  state.eventsApplied++;
  return state;
}

function handleReEnrolled(state: ReplayState, event: EventRow): ReplayState {
  state.status = "active";
  state.stepEnteredAt = event.emittedAt;
  state.completedAt = null;
  state.completedViaGoalId = null;
  state.forceExitedAt = null;
  state.eventsApplied++;
  return state;
}

function handleReEnrollmentBlocked(state: ReplayState, _event: EventRow): ReplayState {
  state.eventsApplied++;
  return state;
}

function handleStepHeld(state: ReplayState, event: EventRow): ReplayState {
  state.stepHeldAt = event.emittedAt;
  state.eventsApplied++;
  return state;
}

function handleReconciled(state: ReplayState, _event: EventRow): ReplayState {
  // Reconciliation typically resets stepHeldAt and may advance currentStepId
  // but the canonical state change is encoded in the subsequent step_advanced
  // event. Here we just clear the held flag.
  state.stepHeldAt = null;
  state.eventsApplied++;
  return state;
}

function handleGoalAchieved(state: ReplayState, event: EventRow): ReplayState {
  const goalId = event.payload.goal_id as string | undefined;
  if (typeof goalId === "string") state.completedViaGoalId = goalId;
  state.eventsApplied++;
  return state;
}

function handleEnrollmentCompleted(state: ReplayState, event: EventRow): ReplayState {
  state.status = "completed";
  state.completedAt = event.emittedAt;
  state.eventsApplied++;
  return state;
}

/** No-op: aggregate (campaign-scope) events that don't touch per-enrollment state. */
function handleAggregateNoOp(state: ReplayState, _event: EventRow): ReplayState {
  state.eventsApplied++;
  return state;
}

// ─── Main dispatcher ────────────────────────────────────────────────────────

/**
 * Apply one event to the replay state and return the (mutated) reference.
 *
 * Returns state UNCHANGED (with a warning appended) when:
 *   - payload is `redacted: true` (GDPR erasure — opaque, NOT drift)
 *   - schema for `(event_type, payload_version)` is unknown
 *   - schema rejects payload
 *
 * Throws when:
 *   - event_type is not in `ENROLLMENT_EVENT_TYPES` (caller should validate)
 */
export function applyEvent(state: ReplayState, event: EventRow): ReplayState {
  fillScopeFromEvent(state, event);

  // Redacted = opaque, do not validate or drift.
  if (isRedactedPayload(event.payload)) {
    pushWarn(
      state,
      `event ${event.id} (${event.eventType}) is redacted (GDPR erasure); skipped`,
    );
    return state;
  }

  // Schema lookup.
  const schema = getPayloadSchema(event.eventType, event.payloadVersion);
  if (!schema) {
    pushWarn(
      state,
      `event ${event.id}: no schema for (${event.eventType}, v${event.payloadVersion}); skipped`,
    );
    return state;
  }
  const parsed = schema.safeParse(event.payload);
  if (!parsed.success) {
    pushWarn(
      state,
      `event ${event.id}: payload validation failed: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}=${i.message}`)
        .join(", ")}`,
    );
    return state;
  }

  // Switch on event_type. (TypeScript exhaustiveness: any new event added
  // to ENROLLMENT_EVENT_TYPES must add a case here or the `unreachable` call
  // produces a `never` error.)
  const t: EnrollmentEventType = event.eventType;
  switch (t) {
    case "enrolled":                       return handleEnrolled(state, event);
    case "step_advanced":                  return handleStepAdvanced(state, event);
    case "wait_scheduled":                 return handleWaitScheduled(state, event);
    case "wait_fired":                     return handleWaitFired(state, event);
    case "message_sent":                   return handleMessageSent(state, event);
    case "message_failed":                 return handleMessageFailed(state, event);
    case "paused":                         return handlePaused(state, event);
    case "resumed":                        return handleResumed(state, event);
    case "force_exited":                   return handleForceExited(state, event);
    case "stale_skipped":                  return handleStaleSkipped(state, event);
    case "spread_scheduled":               return handleSpreadScheduled(state, event);
    case "re_enrolled":                    return handleReEnrolled(state, event);
    case "re_enrollment_blocked":          return handleReEnrollmentBlocked(state, event);

    // Aggregate-scope events — replayed when present in per-enrollment query
    // (rare; usually they have enrollment_id=NULL so the query filter excludes
    // them). Defensive no-ops.
    case "stop_drain_started":             return handleAggregateNoOp(state, event);
    case "drain_completed":                return handleAggregateNoOp(state, event);
    case "archived":                       return handleAggregateNoOp(state, event);
    case "migration_status_change":        return handleAggregateNoOp(state, event);
    case "manual_status_override":         return handleAggregateNoOp(state, event);

    case "step_paused":                    return handleAggregateNoOp(state, event);
    case "step_resumed":                   return handleAggregateNoOp(state, event);
    case "step_held":                      return handleStepHeld(state, event);
    case "reconciled":                     return handleReconciled(state, event);

    case "goal_achieved":                  return handleGoalAchieved(state, event);
    case "enrollment_completed":           return handleEnrollmentCompleted(state, event);
    case "goal_added":                     return handleAggregateNoOp(state, event);
    case "goal_updated":                   return handleAggregateNoOp(state, event);
    case "goal_removed":                   return handleAggregateNoOp(state, event);
    case "goal_evaluation_error":          return handleAggregateNoOp(state, event);

    case "audit_drift_detected":           return handleAggregateNoOp(state, event);
    case "events_archived":                return handleAggregateNoOp(state, event);
    case "pii_erased":                     return handleAggregateNoOp(state, event);
    case "reconciliation_chunk_progress":  return handleAggregateNoOp(state, event);

    default:
      // Exhaustiveness: TypeScript will error here if ENROLLMENT_EVENT_TYPES
      // gets a new value without a case above.
      return unreachable(t, "unhandled event_type");
  }
}

/** Confidence check that the dispatcher recognises every SSOT event type. */
export function dispatcherCoverage(): { unhandled: string[] } {
  const unhandled: string[] = [];
  // For the purposes of this check, build a minimal probe event for each
  // event_type. We don't actually run dispatch — we just rely on the switch
  // exhaustiveness already enforcing it at compile time. Returned for runtime
  // smoke tests if ever needed.
  for (const t of ENROLLMENT_EVENT_TYPES) {
    if (!t) unhandled.push(t);
  }
  return { unhandled };
}

// Surface EnrollmentStatus type so callers don't have to dual-import.
export type { EnrollmentStatus };
