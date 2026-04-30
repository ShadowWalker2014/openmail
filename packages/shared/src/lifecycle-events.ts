/**
 * Lifecycle Events SSOT (Stage 2 — REQ-27, [A2.13], CR-16)
 *
 * Single source of truth for `enrollment_events.event_type` values. All consumers
 * (Drizzle CHECK constraint, Postgres CHECK regen script, Zod validators, replay
 * dispatcher in Stage 6) MUST derive from this const-tuple.
 *
 * **DO NOT** duplicate this list elsewhere — drift here cascades through 4 stages.
 *
 * Future stages extend this single file:
 * - Stage 4: per-step pause events (e.g. `step_held`, `step_resumed`)
 * - Stage 5: goal-based events (e.g. `goal_completed`, `goal_skipped`)
 * - Stage 6: replay/archival meta-events
 *
 * When adding a new event type:
 * 1. Append to `ENROLLMENT_EVENT_TYPES` (do NOT reorder existing entries)
 * 2. Run `bun run check:event-types` (it will fail until migration regenerated)
 * 3. Generate a migration that ALTERs `enrollment_events_event_type_check`
 *    using the audited-migration helper (`packages/shared/src/db/lib/audited-migration.ts`)
 */
import { z } from "zod";

/**
 * 18 initial event types per Stage 2 PRD v1.1.1 [REQ-10].
 *
 * Per-enrollment events (13): emitted with `enrollment_id`, `contact_id`, `event_seq`
 * Campaign-aggregate events (5): emitted with `enrollment_id=NULL`, `event_seq=NULL`
 *
 * Order is significant — the Drizzle CHECK constraint emits values in this order,
 * and the regen script does deep-equal byte comparison. Append-only.
 */
export const ENROLLMENT_EVENT_TYPES = [
  // Per-enrollment events (13)
  "enrolled",
  "step_advanced",
  "wait_scheduled",
  "wait_fired",
  "message_sent",
  "message_failed",
  "paused",
  "resumed",
  "force_exited",
  "stale_skipped",
  "spread_scheduled",
  "re_enrolled",
  "re_enrollment_blocked",

  // Campaign-aggregate events (5)
  "stop_drain_started",
  "drain_completed",
  "archived",
  "migration_status_change",
  "manual_status_override",

  // Stage 4 — per-step pause (REQ-08, CR-01)
  // step_paused: campaign-aggregate (enrollment_id=NULL); operator paused this step
  // step_resumed: campaign-aggregate; operator resumed this step
  // step_held: per-enrollment; enrollment was held at the paused step
  // reconciled: per-enrollment; held enrollment was advanced past a deleted/edited step
  //   (T8 advanceEnrollmentsPastStep + Stage 6 replay self-healing)
  "step_paused",
  "step_resumed",
  "step_held",
  "reconciled",

  // Stage 5 — goal-based early exit (REQ-03..REQ-06, CR-08)
  // goal_achieved: per-enrollment; goal condition matched, enrollment terminating
  // enrollment_completed: per-enrollment; emitted as causal pair after goal_achieved
  //   (also emitted from natural completion paths so dashboards can count completions
  //    uniformly — `payload.via: "goal" | "natural"` distinguishes)
  // goal_added/updated/removed: campaign-aggregate (enrollment_id=NULL); CRUD audit
  // goal_evaluation_error: per-enrollment; evaluator threw — enrollment continues
  //   (graceful degrade per CR-06; payload includes goal_id + error.message)
  "goal_achieved",
  "enrollment_completed",
  "goal_added",
  "goal_updated",
  "goal_removed",
  "goal_evaluation_error",

  // Stage 6 — replay/archival meta events (REQ-15, [A6.3], [A6.4], CR-15)
  // audit_drift_detected: per-enrollment; drift sweeper found mismatch between
  //   replayed state and current row (does NOT auto-fix per CN-06)
  // events_archived: campaign-aggregate; per-workspace summary emitted by the
  //   archival worker after a successful run
  // pii_erased: campaign-aggregate; emitted by the GDPR redaction worker after
  //   walking enrollment_events + archive for a deleted contact
  // reconciliation_chunk_progress: campaign-aggregate; goal-add paginated
  //   reconciliation worker emits one per chunk with progress counters
  "audit_drift_detected",
  "events_archived",
  "pii_erased",
  "reconciliation_chunk_progress",
] as const;

export type EnrollmentEventType = (typeof ENROLLMENT_EVENT_TYPES)[number];

/** Zod validator for any well-formed event_type. */
export const eventTypeZod = z.enum(ENROLLMENT_EVENT_TYPES);

/**
 * Actor identifies the source of a lifecycle transition (CR-11).
 * Stored as JSONB in `enrollment_events.actor` — never NULL, always tagged.
 *
 * - `system`: triggered by automatic engine progression (e.g. wait-step expiry)
 * - `user`: human operator — `userId` references `users.id`
 * - `agent_key`: AI agent via API key — `apiKeyId` references `api_keys.id`
 * - `sweeper`: stop-drain or other sweeper worker — `runId` is per-sweep nanoid
 * - `migration`: schema migration emitted via audited-migration helper (CN-10)
 */
export type Actor =
  | { kind: "system" }
  | { kind: "user"; userId: string }
  | { kind: "agent_key"; apiKeyId: string }
  | { kind: "sweeper"; runId: string }
  | { kind: "migration"; name: string };

export const actorZod = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("system") }),
  z.object({ kind: z.literal("user"), userId: z.string().min(1) }),
  z.object({ kind: z.literal("agent_key"), apiKeyId: z.string().min(1) }),
  z.object({ kind: z.literal("sweeper"), runId: z.string().min(1) }),
  z.object({ kind: z.literal("migration"), name: z.string().min(1) }),
]);
