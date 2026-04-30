-- Stage 6 follow-up: lifecycle webhook endpoints + delivery log.
--
-- Operators register HTTP endpoints to receive lifecycle events. Today the
-- only emitter is the drift sweeper (`audit_drift_detected`); the schema is
-- forward-compatible with subscribing to any of the 32 lifecycle event
-- types so future use cases (e.g. PagerDuty on `force_exited`, Slack on
-- `enrollment_completed`) drop in without migration.
--
-- See PRPs/sota-lifecycle-engine/06-perf-validation.md "Open follow-ups"
-- and AGENTS.md "Audit timeline UI ... gap" history.

CREATE TABLE "lifecycle_webhooks" (
    "id" text PRIMARY KEY NOT NULL,
    "workspace_id" text NOT NULL,
    "url" text NOT NULL,
    -- HMAC-SHA256 signing secret. Stored verbatim — not a credential against
    -- third-party services, just a shared secret with the operator's endpoint.
    "secret" text NOT NULL,
    -- Subscribed event types. Empty array = subscribe to ALL types.
    -- Validated at API level against ENROLLMENT_EVENT_TYPES SSOT.
    "event_types" text[] NOT NULL DEFAULT ARRAY[]::text[],
    "enabled" boolean NOT NULL DEFAULT true,
    "description" text,
    -- Telemetry — populated by the worker on each delivery attempt.
    "last_delivered_at" timestamp with time zone,
    "last_status" integer,
    "last_error" text,
    "consecutive_failures" integer NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "lifecycle_webhooks_url_https_check"
        CHECK (url ~* '^https?://'),
    CONSTRAINT "lifecycle_webhooks_secret_min_len_check"
        CHECK (length(secret) >= 16)
);
--> statement-breakpoint
ALTER TABLE "lifecycle_webhooks"
    ADD CONSTRAINT "lifecycle_webhooks_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "lifecycle_webhooks_workspace_idx"
    ON "lifecycle_webhooks" ("workspace_id");
--> statement-breakpoint
-- Partial index: only enabled webhooks matter for delivery routing.
CREATE INDEX "lifecycle_webhooks_enabled_workspace_idx"
    ON "lifecycle_webhooks" ("workspace_id")
    WHERE "enabled" = true;
