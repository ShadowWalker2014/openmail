CREATE TABLE "campaign_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"condition_type" text NOT NULL,
	"condition_config" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_goals_condition_type_check" CHECK (condition_type IN ('event', 'attribute', 'segment'))
);
--> statement-breakpoint
ALTER TABLE "campaign_goals" ADD CONSTRAINT "campaign_goals_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_goals" ADD CONSTRAINT "campaign_goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_goals_campaign_enabled_idx" ON "campaign_goals" USING btree ("campaign_id","enabled");--> statement-breakpoint
CREATE INDEX "campaign_goals_workspace_idx" ON "campaign_goals" USING btree ("workspace_id");