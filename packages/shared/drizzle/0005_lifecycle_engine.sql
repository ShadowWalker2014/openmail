-- Stage 2 (Round 1) — REQ-06, REQ-07, REQ-08, CR-04, CR-05, CN-05
--
-- Additive-only schema migration for the SOTA Lifecycle Engine. Safe to deploy
-- to live production: no DROP COLUMN, no NOT NULL without DEFAULT, no enum
-- removal. New `campaigns.status` value tuple is a strict superset of the
-- pre-Stage-2 implicit set {draft|active|paused|archived}, so existing rows
-- pass the new CHECK constraint without backfill.
--
-- Pre-existing schema drift (segment_memberships table, broadcasts bounce/complaint
-- counters, status indexes) was already applied manually to production but never
-- migrated; included here so future drizzle-kit runs converge with the live
-- schema. Manual production application of these was historical — re-application
-- via `IF NOT EXISTS` semantics or `--force-non-destructive` review is required
-- if not already present.
--
-- Order of statements is intentional:
--   1. Pre-existing additive items (column adds, indexes that may already exist)
--   2. Stage 2 column additions on campaigns + campaign_enrollments
--   3. Stage 2 CHECK constraints (campaigns.status, re_enrollment_policy)
--
-- enrollment_events table is in migration 0006 (T6) — kept separate so the
-- audit_chokepoint_trigger migration (0007) can reference a stable table.

-- === Pre-existing schema drift (additive) ===

CREATE TABLE IF NOT EXISTS "segment_memberships" (
	"workspace_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "segment_memberships_segment_id_contact_id_pk" PRIMARY KEY("segment_id","contact_id")
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "seg_mem_workspace_idx" ON "segment_memberships" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seg_mem_contact_idx" ON "segment_memberships" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcasts_status_idx" ON "broadcasts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_unsubscribed_idx" ON "contacts" USING btree ("unsubscribed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_events_occurred_at_idx" ON "email_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_resend_msg_idx" ON "email_sends" USING btree ("resend_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_campaign_idx" ON "email_sends" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_created_at_idx" ON "email_sends" USING btree ("created_at");--> statement-breakpoint

ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "bounce_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "complaint_count" integer DEFAULT 0;--> statement-breakpoint

-- === Stage 2: campaign_enrollments additive columns (REQ-07) ===

ALTER TABLE "campaign_enrollments" ADD COLUMN IF NOT EXISTS "next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD COLUMN IF NOT EXISTS "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD COLUMN IF NOT EXISTS "force_exited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD COLUMN IF NOT EXISTS "completed_via_goal_id" text;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD COLUMN IF NOT EXISTS "step_entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD COLUMN IF NOT EXISTS "step_held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD COLUMN IF NOT EXISTS "spread_token" text;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD COLUMN IF NOT EXISTS "stale_skipped_at" timestamp with time zone;--> statement-breakpoint

-- === Stage 2: campaigns additive columns + status CHECK extension (REQ-06, REQ-08) ===
-- campaigns.status is currently TEXT (not pgEnum) per packages/shared/src/db/schema/campaigns.ts;
-- new value tuple {stopping, stopped} added without ALTER TYPE.

ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "re_enrollment_policy" text DEFAULT 'never' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "re_enrollment_cooldown_seconds" integer;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_status_check" CHECK (status IN ('draft', 'active', 'paused', 'stopping', 'stopped', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_re_enrollment_policy_check" CHECK (re_enrollment_policy IN ('never', 'always', 'after_cooldown', 'on_attribute_change'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
