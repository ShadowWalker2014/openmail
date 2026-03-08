ALTER TABLE "workspaces" ADD COLUMN "resend_domain_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "resend_domain_name" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "resend_domain_status" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "resend_domain_records" jsonb;
