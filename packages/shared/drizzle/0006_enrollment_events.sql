-- Stage 2 (Round 1) — REQ-09, REQ-23, REQ-24, REQ-27
--
-- Append-only audit log table for the SOTA Lifecycle Engine. All transitions
-- of campaigns.status and campaign_enrollments.status MUST emit one row here
-- in the SAME transaction as the mutation (CR-01).
--
-- Migration 0007 (audit_chokepoint_trigger) — DEPLOY LAST per [A2.19] — installs
-- a Postgres trigger that BLOCKS status mutations not wrapped with
-- `SET LOCAL lifecycle.audited_tx = 'true'`. Migration 0007 depends on this
-- table existing; 0007 must NOT be applied until worker call sites route
-- through `commitLifecycleStatus()`.
--
-- 4 CHECK constraints, 1 partial UNIQUE, 6 indexes — one of which is GIN over
-- payload to support lifecycle_op_id correlation queries (CR-15).

CREATE TABLE IF NOT EXISTS "enrollment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"enrollment_id" text,
	"campaign_id" text NOT NULL,
	"contact_id" text,
	"workspace_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_version" smallint DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"actor" jsonb NOT NULL,
	"event_seq" bigint,
	"tx_id" text,
	"emitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_events_scope_check" CHECK (("enrollment_id" IS NOT NULL OR "campaign_id" IS NOT NULL)),
	CONSTRAINT "enrollment_events_contact_required_check" CHECK (("enrollment_id" IS NULL OR "contact_id" IS NOT NULL)),
	CONSTRAINT "enrollment_events_seq_required_check" CHECK (("enrollment_id" IS NULL OR "event_seq" IS NOT NULL)),
	CONSTRAINT "enrollment_events_event_type_check" CHECK (event_type IN (
		'enrolled', 'step_advanced', 'wait_scheduled', 'wait_fired',
		'message_sent', 'message_failed', 'paused', 'resumed',
		'force_exited', 'stale_skipped', 'spread_scheduled',
		're_enrolled', 're_enrollment_blocked',
		'stop_drain_started', 'drain_completed', 'archived',
		'migration_status_change', 'manual_status_override'
	))
);
--> statement-breakpoint

-- Per-enrollment monotonic event_seq (DB-12). Partial — aggregate events excluded.
CREATE UNIQUE INDEX IF NOT EXISTS "enrollment_events_enroll_seq_uniq"
	ON "enrollment_events" USING btree ("enrollment_id","event_seq")
	WHERE "enrollment_id" IS NOT NULL;
--> statement-breakpoint

-- Replay query: scan one enrollment in chronological order
CREATE INDEX IF NOT EXISTS "enrollment_events_enrollment_emitted_idx"
	ON "enrollment_events" USING btree ("enrollment_id","emitted_at")
	WHERE "enrollment_id" IS NOT NULL;
--> statement-breakpoint

-- Aggregate + per-enrollment scan: all events for one campaign
CREATE INDEX IF NOT EXISTS "enrollment_events_campaign_emitted_idx"
	ON "enrollment_events" USING btree ("campaign_id","emitted_at");
--> statement-breakpoint

-- Workspace-wide audit dashboard
CREATE INDEX IF NOT EXISTS "enrollment_events_workspace_emitted_idx"
	ON "enrollment_events" USING btree ("workspace_id","emitted_at");
--> statement-breakpoint

-- Filter by event type (e.g., "all paused events in last 24h")
CREATE INDEX IF NOT EXISTS "enrollment_events_event_type_idx"
	ON "enrollment_events" USING btree ("event_type");
--> statement-breakpoint

-- Per-contact lifecycle history (PII forensics, support cases)
CREATE INDEX IF NOT EXISTS "enrollment_events_contact_emitted_idx"
	ON "enrollment_events" USING btree ("contact_id","emitted_at")
	WHERE "contact_id" IS NOT NULL;
--> statement-breakpoint

-- GIN on payload — supports lifecycle_op_id correlation queries (CR-15):
--   WHERE payload @> '{"lifecycle_op_id": "lop_..."}'
CREATE INDEX IF NOT EXISTS "enrollment_events_payload_gin_idx"
	ON "enrollment_events" USING gin ("payload");
