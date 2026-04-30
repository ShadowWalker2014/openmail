ALTER TABLE "campaign_steps" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_status_check" CHECK (status IN ('active', 'paused'));