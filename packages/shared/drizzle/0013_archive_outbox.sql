-- Stage 6 — Archive table + outbox table + extended event_type CHECK.

CREATE TABLE IF NOT EXISTS "enrollment_events_archive" (
  "id"               text PRIMARY KEY NOT NULL,
  "enrollment_id"    text,
  "campaign_id"      text NOT NULL,
  "contact_id"       text,
  "workspace_id"     text NOT NULL,
  "event_type"       text NOT NULL,
  "payload_version"  smallint NOT NULL DEFAULT 1,
  "payload"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "before"           jsonb,
  "after"            jsonb,
  "actor"            jsonb NOT NULL,
  "event_seq"        bigint,
  "tx_id"            text,
  "emitted_at"       timestamp with time zone NOT NULL,
  "archived_at"      timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "enrollment_events_archive_enrollment_emitted_idx"
  ON "enrollment_events_archive" ("enrollment_id", "emitted_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "enrollment_events_archive_workspace_emitted_idx"
  ON "enrollment_events_archive" ("workspace_id", "emitted_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "campaign_edit_outbox" (
  "id"                bigserial PRIMARY KEY NOT NULL,
  "workspace_id"      text NOT NULL,
  "campaign_id"       text NOT NULL,
  "edit_type"         text NOT NULL,
  "details"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "lifecycle_op_id"   text NOT NULL,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "forwarded_at"      timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "campaign_edit_outbox"
  ADD CONSTRAINT "campaign_edit_outbox_edit_type_check"
  CHECK (edit_type IN ('wait_duration_changed','step_inserted','step_deleted','email_template_changed','goal_added','goal_updated','goal_removed'));
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "campaign_edit_outbox_forwarded_at_idx"
  ON "campaign_edit_outbox" ("forwarded_at")
  WHERE forwarded_at IS NULL;
--> statement-breakpoint

ALTER TABLE "enrollment_events" DROP CONSTRAINT IF EXISTS "enrollment_events_event_type_check";
--> statement-breakpoint
ALTER TABLE "enrollment_events" ADD CONSTRAINT "enrollment_events_event_type_check" CHECK (event_type IN ('enrolled', 'step_advanced', 'wait_scheduled', 'wait_fired', 'message_sent', 'message_failed', 'paused', 'resumed', 'force_exited', 'stale_skipped', 'spread_scheduled', 're_enrolled', 're_enrollment_blocked', 'stop_drain_started', 'drain_completed', 'archived', 'migration_status_change', 'manual_status_override', 'step_paused', 'step_resumed', 'step_held', 'reconciled', 'goal_achieved', 'enrollment_completed', 'goal_added', 'goal_updated', 'goal_removed', 'goal_evaluation_error', 'audit_drift_detected', 'events_archived', 'pii_erased', 'reconciliation_chunk_progress'));
