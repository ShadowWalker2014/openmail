CREATE TABLE "workspace_lifecycle_settings" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"resume_dialog_threshold" integer DEFAULT 100 NOT NULL,
	"default_spread_window_seconds" integer DEFAULT 14400 NOT NULL,
	"default_stale_threshold_seconds" integer DEFAULT 604800 NOT NULL,
	"default_resume_mode" text DEFAULT 'immediate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_lifecycle_settings_resume_mode_check" CHECK (default_resume_mode IN ('immediate', 'spread', 'skip_stale', 'skip_stale_spread')),
	CONSTRAINT "workspace_lifecycle_settings_spread_window_bounds_check" CHECK (default_spread_window_seconds >= 60 AND default_spread_window_seconds <= 2592000),
	CONSTRAINT "workspace_lifecycle_settings_stale_threshold_bounds_check" CHECK (default_stale_threshold_seconds >= 3600 AND default_stale_threshold_seconds <= 31536000),
	CONSTRAINT "workspace_lifecycle_settings_dialog_threshold_bounds_check" CHECK (resume_dialog_threshold >= 0 AND resume_dialog_threshold <= 1000000)
);
--> statement-breakpoint
ALTER TABLE "workspace_lifecycle_settings" ADD CONSTRAINT "workspace_lifecycle_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;