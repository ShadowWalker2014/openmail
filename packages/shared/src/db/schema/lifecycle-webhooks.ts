/**
 * Lifecycle webhook endpoints (Stage 6 follow-up — drift webhook).
 *
 * Per-workspace HTTP endpoints that receive lifecycle audit events.
 * Today the only emitter is the drift sweeper (`audit_drift_detected`)
 * — schema is forward-compatible with subscribing to any of the 32
 * lifecycle event types.
 *
 * Delivery semantics:
 *   - At-least-once via BullMQ `lifecycle-webhook-delivery` queue with
 *     exponential backoff on transient failures (network / 5xx).
 *   - Permanent failures (4xx) → mark consecutive_failures, give up
 *     after N (env: LIFECYCLE_WEBHOOK_MAX_RETRIES, default 6).
 *   - Idempotency: each delivery has a unique `X-OpenMail-Delivery` UUID
 *     in the header — operator endpoints SHOULD dedupe by it.
 *
 * Signing: HMAC-SHA256 over the raw JSON body, hex-encoded, sent in
 * `X-OpenMail-Signature: sha256=<hex>` header. Operator's endpoint
 * verifies by recomputing with the shared `secret` field.
 *
 * No FK on event_types[] — the SSOT (`packages/shared/src/lifecycle-events.ts`)
 * is enforced at the API layer with Zod, NOT at the column level (Postgres
 * arrays don't support FK to enum, and event types extend over time).
 */
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspaces.js";

export const lifecycleWebhooks = pgTable(
  "lifecycle_webhooks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    eventTypes: text("event_types")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    enabled: boolean("enabled").notNull().default(true),
    description: text("description"),
    // Telemetry (worker-managed)
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "lifecycle_webhooks_url_https_check",
      sql`url ~* '^https?://'`,
    ),
    check(
      "lifecycle_webhooks_secret_min_len_check",
      sql`length(secret) >= 16`,
    ),
    index("lifecycle_webhooks_workspace_idx").on(t.workspaceId),
  ],
);

export type LifecycleWebhook = typeof lifecycleWebhooks.$inferSelect;
export type LifecycleWebhookInsert = typeof lifecycleWebhooks.$inferInsert;
