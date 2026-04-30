/**
 * Stage 6 — Per-(event_type, payload_version) Zod schemas (REQ-14, [A6.8],
 * CR-04, CR-18).
 *
 * The replay dispatcher (Stage 6) keys cases on `(event_type, payload_version)`
 * tuple. Adding a new event type without a schema = compile error in
 * `replay-event-dispatch.ts`. Adding a new version of an existing event type
 * = MUST register here BEFORE the dispatcher will accept it.
 *
 * Forward-compat philosophy:
 *   - All payloads MUST include `lifecycle_op_id: string` (12-char nanoid).
 *   - All payloads are open (`.passthrough()`) so unknown fields are tolerated
 *     during replay; the dispatcher only reads the fields it needs.
 *   - When a new version of an existing event ships, register schema as v2
 *     here; the dispatcher must add a case for it (TS exhaustiveness check).
 *
 * "redacted" handling per [A6.4]:
 *   The PII redaction worker REPLACES `payload` (and `before` / `after`) with
 *   `{redacted: true, reason, redacted_at, original_event_type}`. Replay
 *   detects this in the dispatcher and treats the event as opaque (warn,
 *   don't drift) rather than failing the validation.
 */
import { z } from "zod";
import { ENROLLMENT_EVENT_TYPES, type EnrollmentEventType } from "./lifecycle-events.js";

// ─── Common fragments ───────────────────────────────────────────────────────

/** Required on every non-redacted payload. */
const opIdFragment = z.object({
  lifecycle_op_id: z.string().min(1),
});

/**
 * "Redacted" sentinel — payloads that have been GDPR-erased look like this
 * and the dispatcher short-circuits before doing event-specific decoding.
 */
export const redactedPayloadSchema = z
  .object({
    redacted: z.literal(true),
    reason: z.string(),
    redacted_at: z.union([z.string(), z.date()]),
    original_event_type: z.string(),
  })
  .passthrough();

export function isRedactedPayload(p: unknown): p is z.infer<typeof redactedPayloadSchema> {
  return (
    typeof p === "object" &&
    p !== null &&
    (p as Record<string, unknown>).redacted === true
  );
}

// ─── Per-event v1 schemas ───────────────────────────────────────────────────
//
// Each is a `.passthrough()` extension of `opIdFragment` — the dispatcher
// reads only what it needs. The shapes encoded here document the canonical
// fields a payload SHOULD carry; missing fields are tolerated (warning) so
// replay doesn't break on legacy events that predate later additions.

const enrolledV1 = opIdFragment.extend({
  trigger_type: z.string().optional(),
  trigger_event_id: z.string().optional(),
}).passthrough();

const stepAdvancedV1 = opIdFragment.extend({
  from_step_id: z.string().nullable().optional(),
  to_step_id: z.string().optional(),
  to_position: z.number().optional(),
}).passthrough();

const waitScheduledV1 = opIdFragment.extend({
  step_id: z.string(),
  delay_seconds: z.number().optional(),
  next_run_at: z.union([z.string(), z.date()]).optional(),
}).passthrough();

const waitFiredV1 = opIdFragment.extend({
  step_id: z.string(),
}).passthrough();

const messageSentV1 = opIdFragment.extend({
  step_id: z.string().optional(),
  send_id: z.string().optional(),
}).passthrough();

const messageFailedV1 = opIdFragment.extend({
  step_id: z.string().optional(),
  send_id: z.string().optional(),
  error: z.string().optional(),
}).passthrough();

const pausedV1 = opIdFragment.passthrough();
const resumedV1 = opIdFragment.extend({
  mode: z
    .enum(["immediate", "spread", "skip_stale", "skip_stale_spread"])
    .optional(),
}).passthrough();

const forceExitedV1 = opIdFragment.extend({
  reason: z.string().optional(),
}).passthrough();

const staleSkippedV1 = opIdFragment.extend({
  step_id: z.string().optional(),
  reason: z.string().optional(),
  age_ms: z.number().optional(),
  threshold_ms: z.number().optional(),
}).passthrough();

const spreadScheduledV1 = opIdFragment.extend({
  spread_token: z.string().optional(),
  next_run_at: z.union([z.string(), z.date()]).optional(),
}).passthrough();

const reEnrolledV1 = opIdFragment.passthrough();
const reEnrollmentBlockedV1 = opIdFragment.extend({
  policy: z.string().optional(),
}).passthrough();

const stopDrainStartedV1 = opIdFragment.passthrough();
const drainCompletedV1 = opIdFragment.passthrough();
const archivedV1 = opIdFragment.passthrough();
const migrationStatusChangeV1 = opIdFragment.passthrough();
const manualStatusOverrideV1 = opIdFragment.passthrough();

// Stage 4 step-pause
const stepPausedV1 = opIdFragment.extend({
  step_id: z.string(),
  step_position: z.number().optional(),
  held_count: z.number().optional(),
}).passthrough();

const stepResumedV1 = opIdFragment.extend({
  step_id: z.string(),
  step_position: z.number().optional(),
}).passthrough();

const stepHeldV1 = opIdFragment.extend({
  step_id: z.string(),
  step_position: z.number().optional(),
}).passthrough();

const reconciledV1 = opIdFragment.extend({
  step_id: z.string().optional(),
  reason: z.string().optional(),
  edit_type: z.string().optional(),
}).passthrough();

// Stage 5 goal events
const goalAchievedV1 = opIdFragment.extend({
  goal_id: z.string(),
  condition_type: z.string().optional(),
}).passthrough();

const enrollmentCompletedV1 = opIdFragment.extend({
  via: z.enum(["goal", "natural"]).optional(),
  goal_id: z.string().nullable().optional(),
}).passthrough();

const goalAddedV1 = opIdFragment.extend({
  goal_id: z.string(),
  condition_type: z.string().optional(),
}).passthrough();

const goalUpdatedV1 = opIdFragment.extend({
  goal_id: z.string(),
}).passthrough();

const goalRemovedV1 = opIdFragment.extend({
  goal_id: z.string(),
}).passthrough();

const goalEvaluationErrorV1 = opIdFragment.extend({
  goal_id: z.string().optional(),
  error: z.string().optional(),
}).passthrough();

// Stage 6 meta events
const auditDriftDetectedV1 = opIdFragment.extend({
  enrollment_id: z.string(),
  diff: z.record(z.string(), z.unknown()).optional(),
  source: z.enum(["sweeper", "cli"]).optional(),
}).passthrough();

const eventsArchivedV1 = opIdFragment.extend({
  archived_count: z.number(),
  cutoff_at: z.union([z.string(), z.date()]),
  workspace_id: z.string().optional(),
}).passthrough();

const piiErasedV1 = opIdFragment.extend({
  contact_id: z.string(),
  event_count: z.number(),
}).passthrough();

const reconciliationChunkProgressV1 = opIdFragment.extend({
  edit_type: z.string(),
  chunk_index: z.number(),
  total_chunks: z.number().optional(),
  matched_count: z.number(),
}).passthrough();

// ─── Lookup table ───────────────────────────────────────────────────────────
//
// Keyed by `${event_type}:${payload_version}`. The dispatcher uses this to
// validate a payload BEFORE applying it to the replay state. Unknown key =
// warning (legacy event with payload version we don't handle yet).

type SchemaMap = Record<string, z.ZodTypeAny>;

export const PAYLOAD_SCHEMAS: SchemaMap = {
  "enrolled:1": enrolledV1,
  "step_advanced:1": stepAdvancedV1,
  "wait_scheduled:1": waitScheduledV1,
  "wait_fired:1": waitFiredV1,
  "message_sent:1": messageSentV1,
  "message_failed:1": messageFailedV1,
  "paused:1": pausedV1,
  "resumed:1": resumedV1,
  "force_exited:1": forceExitedV1,
  "stale_skipped:1": staleSkippedV1,
  "spread_scheduled:1": spreadScheduledV1,
  "re_enrolled:1": reEnrolledV1,
  "re_enrollment_blocked:1": reEnrollmentBlockedV1,
  "stop_drain_started:1": stopDrainStartedV1,
  "drain_completed:1": drainCompletedV1,
  "archived:1": archivedV1,
  "migration_status_change:1": migrationStatusChangeV1,
  "manual_status_override:1": manualStatusOverrideV1,
  "step_paused:1": stepPausedV1,
  "step_resumed:1": stepResumedV1,
  "step_held:1": stepHeldV1,
  "reconciled:1": reconciledV1,
  "goal_achieved:1": goalAchievedV1,
  "enrollment_completed:1": enrollmentCompletedV1,
  "goal_added:1": goalAddedV1,
  "goal_updated:1": goalUpdatedV1,
  "goal_removed:1": goalRemovedV1,
  "goal_evaluation_error:1": goalEvaluationErrorV1,
  "audit_drift_detected:1": auditDriftDetectedV1,
  "events_archived:1": eventsArchivedV1,
  "pii_erased:1": piiErasedV1,
  "reconciliation_chunk_progress:1": reconciliationChunkProgressV1,
};

export function getPayloadSchema(
  eventType: EnrollmentEventType,
  payloadVersion: number,
): z.ZodTypeAny | null {
  return PAYLOAD_SCHEMAS[`${eventType}:${payloadVersion}`] ?? null;
}

/** Smoke check that every event type in SSOT has at least a v1 schema registered. */
export function assertSchemaCoverage(): { missing: string[] } {
  const missing: string[] = [];
  for (const t of ENROLLMENT_EVENT_TYPES) {
    if (!PAYLOAD_SCHEMAS[`${t}:1`]) missing.push(t);
  }
  return { missing };
}
