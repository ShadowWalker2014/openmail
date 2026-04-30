/**
 * Stage 6 — Transactional outbox for campaign edits (REQ-12, [A6.1], CR-11).
 *
 * Architect review F6.3 (CRITICAL): post-commit Redis publishes can be lost
 * on API process crash. The outbox pattern guarantees AT-LEAST-ONCE delivery:
 *
 *   1. API edit handler writes outbox row in same DB tx as the campaign edit.
 *   2. Outbox worker (`worker/src/jobs/process-outbox.ts`) polls/listens for
 *      `forwarded_at IS NULL` rows, publishes to Redis `campaign-edits`
 *      channel, then UPDATE forwarded_at = NOW().
 *   3. Reconciliation worker subscribes to the channel; idempotency by
 *      `lifecycle_op_id` (Redis SET TTL 24h) ensures double-deliveries are
 *      no-ops.
 *
 * Edit types tracked:
 *   - wait_duration_changed     — wait-step config edit
 *   - step_inserted             — new step added mid-flight
 *   - step_deleted              — step removed
 *   - email_template_changed    — email step config edit
 *   - goal_added/updated/removed — campaign goal CRUD
 */
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  bigserial,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const CAMPAIGN_EDIT_TYPES = [
  "wait_duration_changed",
  "step_inserted",
  "step_deleted",
  "email_template_changed",
  "goal_added",
  "goal_updated",
  "goal_removed",
] as const;

export type CampaignEditType = (typeof CAMPAIGN_EDIT_TYPES)[number];

export const campaignEditOutbox = pgTable(
  "campaign_edit_outbox",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    campaignId: text("campaign_id").notNull(),
    editType: text("edit_type").notNull(),
    /**
     * Edit-specific details. Examples:
     *   {stepId, oldDelaySeconds, newDelaySeconds}                 (wait_duration_changed)
     *   {stepId, position}                                          (step_inserted/deleted)
     *   {stepId, oldTemplateId, newTemplateId}                     (email_template_changed)
     *   {goalId, conditionType, conditionConfig}                   (goal_added/updated/removed)
     */
    details: jsonb("details").notNull().default({}),
    lifecycleOpId: text("lifecycle_op_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** NULL until the outbox worker has published to Redis successfully. */
    forwardedAt: timestamp("forwarded_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "campaign_edit_outbox_edit_type_check",
      sql.raw(
        `edit_type IN (${CAMPAIGN_EDIT_TYPES.map((v) => `'${v}'`).join(", ")})`,
      ),
    ),
    // Partial index: outbox worker scans only the unforwarded subset; once
    // forwarded_at is set, the row is invisible to the index — keeping its
    // size bounded by the in-flight publish backlog.
    index("campaign_edit_outbox_forwarded_at_idx")
      .on(t.forwardedAt)
      .where(sql`${t.forwardedAt} IS NULL`),
  ],
);
