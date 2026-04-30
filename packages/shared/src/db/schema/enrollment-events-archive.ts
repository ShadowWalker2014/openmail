/**
 * Stage 6 — Enrollment events archive (REQ-17, [A6.3], CR-05/CR-14).
 *
 * Identical column layout to `enrollment_events`, but with a smaller index
 * footprint per the plan: only the two indexes needed for archival reads
 * (per-enrollment chronological + per-workspace chronological). Replay
 * with `--include-archive` UNIONs both tables ordered by event_seq.
 *
 * Archived rows preserve ALL original metadata bit-exact:
 *   id, enrollment_id, campaign_id, contact_id, workspace_id, event_type,
 *   payload_version, payload, before, after, actor, event_seq, tx_id,
 *   emitted_at
 *
 * The archival worker (`worker/src/jobs/process-event-archival.ts`) runs:
 *   WITH to_archive AS (
 *     DELETE FROM enrollment_events
 *      WHERE emitted_at < now() - interval 'N days'
 *        AND workspace_id = $1
 *      RETURNING *
 *   )
 *   INSERT INTO enrollment_events_archive SELECT * FROM to_archive
 *
 * (single transaction, per-workspace `pg_advisory_xact_lock` serializing
 * concurrent archival runs on the same workspace.)
 *
 * No CHECK constraint on event_type — archive accepts whatever was valid at
 * the time of archival, including event types later removed from the SSOT.
 */
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  smallint,
  bigint,
  index,
} from "drizzle-orm/pg-core";

export const enrollmentEventsArchive = pgTable(
  "enrollment_events_archive",
  {
    id: text("id").primaryKey(), // eev_<12-char-nanoid> — unchanged
    enrollmentId: text("enrollment_id"),
    campaignId: text("campaign_id").notNull(),
    contactId: text("contact_id"),
    workspaceId: text("workspace_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadVersion: smallint("payload_version").notNull().default(1),
    payload: jsonb("payload").notNull().default({}),
    before: jsonb("before"),
    after: jsonb("after"),
    actor: jsonb("actor").notNull(),
    eventSeq: bigint("event_seq", { mode: "bigint" }),
    txId: text("tx_id"),
    emittedAt: timestamp("emitted_at", { withTimezone: true }).notNull(),
    /** When this row was moved into the archive. */
    archivedAt: timestamp("archived_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("enrollment_events_archive_enrollment_emitted_idx").on(
      t.enrollmentId,
      t.emittedAt,
    ),
    index("enrollment_events_archive_workspace_emitted_idx").on(
      t.workspaceId,
      t.emittedAt,
    ),
  ],
);
