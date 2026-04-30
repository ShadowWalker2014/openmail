import {
  pgTable,
  text,
  timestamp,
  jsonb,
  smallint,
  bigint,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ENROLLMENT_EVENT_TYPES } from "../../lifecycle-events";

/**
 * Stage 2 (REQ-09, REQ-23, REQ-24, REQ-27).
 *
 * Append-only audit log of every campaign + enrollment lifecycle transition.
 * Foundation for Stages 3–6; mistakes here cascade.
 *
 * Design invariants (per PRD v1.1.1):
 * - Append-only — application code MUST NOT delete (CN-08). PII redaction is the
 *   only future exception (Stage 6, separate PRP).
 * - `enrollment_id` NULLABLE day-one [DB-11] — supports campaign-aggregate events
 *   (stop_drain_started, drain_completed, archived, migration_status_change,
 *   manual_status_override) that have no per-enrollment scope.
 * - `event_seq` per-enrollment monotonic [DB-12] — assigned by lifecycle-audit
 *   helper via `SELECT … FOR UPDATE` + `MAX(event_seq)+1`. UNIQUE constraint
 *   below (partial WHERE enrollment_id IS NOT NULL) forces retry on race.
 * - `payload_version` SMALLINT [DB-15] — replay dispatcher (Stage 6) keys on
 *   `(event_type, payload_version)` for forward-compat.
 * - `before` / `after` are delta-only (CN-12) — only mutated fields, never full
 *   row snapshots; enforced by lifecycle-audit helper size-budget check.
 * - `actor` NEVER NULL (CR-11) — always tagged with kind + identifier so
 *   "who paused this campaign?" is answerable forensically.
 *
 * No CASCADE FK to campaign_enrollments — the row may be hard-deleted (per
 * AGENTS.md "hard delete only") but events outlive their parent for forensics
 * (CN-08). Use `campaign_id` for cleanup queries instead.
 */
export const enrollmentEvents = pgTable(
  "enrollment_events",
  {
    id: text("id").primaryKey(), // eev_<12-char-nanoid>

    // Scope identifiers — see CHECK constraints below
    enrollmentId: text("enrollment_id"), // NULLABLE per [A2.1] / [DB-11]
    campaignId: text("campaign_id").notNull(), // always present (per-enroll OR aggregate)
    contactId: text("contact_id"), // NULL iff enrollment_id IS NULL (aggregate)
    workspaceId: text("workspace_id").notNull(),

    eventType: text("event_type").notNull(),

    // Payload + delta
    payloadVersion: smallint("payload_version").notNull().default(1),
    payload: jsonb("payload").notNull().default({}),
    before: jsonb("before"), // delta-only, mutated fields only
    after: jsonb("after"), // delta-only, mutated fields only

    // Actor (CR-11) — discriminated union per Actor type
    actor: jsonb("actor").notNull(),

    // Per-enrollment monotonic sequence; NULL for aggregate events (REQ-24, [A2.16])
    eventSeq: bigint("event_seq", { mode: "bigint" }),

    txId: text("tx_id"),
    emittedAt: timestamp("emitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // CHECK 1: every event must scope to enrollment OR campaign
    check(
      "enrollment_events_scope_check",
      sql`(${t.enrollmentId} IS NOT NULL OR ${t.campaignId} IS NOT NULL)`,
    ),
    // CHECK 2: per-enrollment events must have contact_id
    check(
      "enrollment_events_contact_required_check",
      sql`(${t.enrollmentId} IS NULL OR ${t.contactId} IS NOT NULL)`,
    ),
    // CHECK 3: per-enrollment events must have event_seq
    check(
      "enrollment_events_seq_required_check",
      sql`(${t.enrollmentId} IS NULL OR ${t.eventSeq} IS NOT NULL)`,
    ),
    // CHECK 4: event_type whitelist (T1a regen script keeps this in sync)
    check(
      "enrollment_events_event_type_check",
      sql.raw(
        `event_type IN (${ENROLLMENT_EVENT_TYPES.map((v) => `'${v}'`).join(", ")})`,
      ),
    ),

    // UNIQUE: per-enrollment event_seq monotonic (partial — aggregates excluded)
    uniqueIndex("enrollment_events_enroll_seq_uniq")
      .on(t.enrollmentId, t.eventSeq)
      .where(sql`${t.enrollmentId} IS NOT NULL`),

    // 6 indexes per PRD spec — drive replay queries, workspace scans, op-id correlation
    index("enrollment_events_enrollment_emitted_idx")
      .on(t.enrollmentId, t.emittedAt)
      .where(sql`${t.enrollmentId} IS NOT NULL`),
    index("enrollment_events_campaign_emitted_idx").on(
      t.campaignId,
      t.emittedAt,
    ),
    index("enrollment_events_workspace_emitted_idx").on(
      t.workspaceId,
      t.emittedAt,
    ),
    index("enrollment_events_event_type_idx").on(t.eventType),
    index("enrollment_events_contact_emitted_idx")
      .on(t.contactId, t.emittedAt)
      .where(sql`${t.contactId} IS NOT NULL`),
    // GIN index on payload for ad-hoc queries (e.g. lifecycle_op_id correlation per CR-15)
    index("enrollment_events_payload_gin_idx").using("gin", t.payload),
  ],
);
