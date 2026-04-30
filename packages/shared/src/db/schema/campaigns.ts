import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspaces";
import {
  CAMPAIGN_STATUS_VALUES,
  RE_ENROLLMENT_POLICY_VALUES,
} from "../../lifecycle-constants";

/**
 * Stage 2 (REQ-06, REQ-08): `campaigns.status` was previously TEXT with implicit
 * values {draft, active, paused, archived}. Stage 2 extends the value set to
 * include `stopping`, `stopped` and adds a CHECK constraint to lock down
 * accepted values. Pre-existing rows are guaranteed valid because the new tuple
 * is a strict superset of the implicit pre-Stage-2 set.
 *
 * Re-enrollment policy (REQ-08, CR-05): default `'never'` preserves the
 * pre-Stage-2 implicit "no re-enrollment" behavior. Existing rows backfill to
 * `'never'` via DEFAULT — no row touch required.
 */
export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("draft"),
    triggerType: text("trigger_type").notNull(),
    triggerConfig: jsonb("trigger_config").notNull().default({}),
    // Stage 2 — re-enrollment policy (REQ-08, DB-05, CR-05)
    reEnrollmentPolicy: text("re_enrollment_policy")
      .notNull()
      .default("never"),
    reEnrollmentCooldownSeconds: integer("re_enrollment_cooldown_seconds"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "campaigns_status_check",
      sql.raw(
        `status IN (${CAMPAIGN_STATUS_VALUES.map((v) => `'${v}'`).join(", ")})`,
      ),
    ),
    check(
      "campaigns_re_enrollment_policy_check",
      sql.raw(
        `re_enrollment_policy IN (${RE_ENROLLMENT_POLICY_VALUES.map(
          (v) => `'${v}'`,
        ).join(", ")})`,
      ),
    ),
  ],
);

/**
 * Stage 4 (REQ-08, CR-01): per-step pause requires status tracking on each step
 * row. `status='paused'` halts NEW arrivals at this step (held) but does NOT
 * affect enrollments at OTHER steps. `paused_at` records the hold timestamp.
 * Existing rows backfill to `'active'` via DEFAULT — no row touch required.
 */
export const campaignSteps = pgTable(
  "campaign_steps",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    stepType: text("step_type").notNull(),
    config: jsonb("config").notNull().default({}),
    position: integer("position").notNull().default(0),
    nextStepId: text("next_step_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // Stage 4 — per-step pause (REQ-08, CR-01)
    status: text("status").notNull().default("active"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
  },
  () => [
    check(
      "campaign_steps_status_check",
      sql.raw(`status IN ('active', 'paused')`),
    ),
  ],
);

/**
 * Stage 2 (REQ-07): additive nullable timestamps + tokens for downstream stages.
 *
 * - `next_run_at` (Stage 3): when this enrollment is scheduled to run next; replaces
 *   in-memory BullMQ-only knowledge so audit replays can reconstruct sleep state
 * - `paused_at` (Stage 2): when enrollment was paused via verb endpoint
 * - `force_exited_at` (Stage 2): set by stop-force or sweeper-force-during-drain
 * - `completed_via_goal_id` (Stage 5): which goal terminated the enrollment
 * - `step_entered_at` (Stage 6): when current step started; backfill on first touch
 * - `step_held_at` (Stage 4): per-step pause hold timestamp
 * - `spread_token` (Stage 3): groups enrollments scheduled by same spread directive
 * - `stale_skipped_at` (Stage 3): set when resume mode='skip_stale' skips an enrollment
 *
 * All nullable, all NULL by default — no backfill required (CN-05).
 */
export const campaignEnrollments = pgTable(
  "campaign_enrollments",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    contactId: text("contact_id").notNull(),
    currentStepId: text("current_step_id"),
    status: text("status").notNull().default("active"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // Stage 2/3/4/5/6 additive columns (REQ-07)
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    forceExitedAt: timestamp("force_exited_at", { withTimezone: true }),
    completedViaGoalId: text("completed_via_goal_id"),
    stepEnteredAt: timestamp("step_entered_at", { withTimezone: true }),
    stepHeldAt: timestamp("step_held_at", { withTimezone: true }),
    spreadToken: text("spread_token"),
    staleSkippedAt: timestamp("stale_skipped_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("campaign_enrollments_campaign_contact_idx").on(
      t.campaignId,
      t.contactId,
    ),
  ],
);
