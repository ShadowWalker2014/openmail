/**
 * Stage 5 (Goal-Based Early Exit) — campaign_goals table.
 *
 * A goal is a campaign-scoped condition that, when met by a contact's state,
 * terminates that contact's enrollment early. Multiple goals on a campaign
 * are evaluated with OR semantics (first match wins). `position` is for
 * display order only — the engine does not short-circuit by position.
 *
 * Goal exits set `campaign_enrollments.completed_via_goal_id` to this row's
 * id and emit paired audit events `goal_achieved` + `enrollment_completed`
 * (causal pair per CR-08). Natural completion leaves `completed_via_goal_id`
 * NULL.
 *
 * Condition types (REQ-03):
 * - `event`     — fires when a tracked event matching `condition_config` is
 *                  observed since `enrollment.startedAt` (CN-01).
 * - `attribute` — fires when `contact_attributes.<key>` matches operator/value.
 * - `segment`   — fires when contact's segment membership matches `segmentId`
 *                  (delegates to segment-evaluator).
 *
 * Schema mirrors `segments.ts` style. PK uses `gol_` prefix (12-char nanoid).
 * Hard-deletable per AGENTS.md "hard delete only" — cache invalidation handled
 * via Redis pub/sub at the API layer (Task 9).
 */
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { campaigns } from "./campaigns";
import { workspaces } from "./workspaces";

/**
 * Allowed condition_type values. Append-only — additions require a migration
 * that ALTERs the CHECK constraint. CHECK is enforced at the DB level so
 * malformed inserts (e.g. via raw SQL) are caught even outside the API layer.
 */
export const CAMPAIGN_GOAL_CONDITION_TYPES = [
  "event",
  "attribute",
  "segment",
] as const;
export type CampaignGoalConditionType =
  (typeof CAMPAIGN_GOAL_CONDITION_TYPES)[number];

export const campaignGoals = pgTable(
  "campaign_goals",
  {
    id: text("id").primaryKey(), // gol_<12-char-nanoid>
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conditionType: text("condition_type").notNull(),
    /**
     * Shape depends on `condition_type`:
     * - event:     { eventName: string, propertyFilter?: Record<string, unknown>, sinceEnrollment?: boolean }
     * - attribute: { attributeKey: string, operator: "eq"|"neq"|"gt"|"lt"|"contains"|"exists", value?: unknown }
     * - segment:   { segmentId: string, requireMembership?: boolean }
     *
     * Validated at API boundary (Zod discriminated union — Task 9).
     */
    conditionConfig: jsonb("condition_config").notNull(),
    /** Display order only. OR semantics — engine doesn't short-circuit. */
    position: integer("position").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "campaign_goals_condition_type_check",
      sql.raw(
        `condition_type IN (${CAMPAIGN_GOAL_CONDITION_TYPES.map(
          (v) => `'${v}'`,
        ).join(", ")})`,
      ),
    ),
    // Hot-path lookup: load all enabled goals for a campaign.
    index("campaign_goals_campaign_enabled_idx").on(t.campaignId, t.enabled),
    // Workspace scope (multi-tenant queries).
    index("campaign_goals_workspace_idx").on(t.workspaceId),
  ],
);

export type CampaignGoal = typeof campaignGoals.$inferSelect;
export type NewCampaignGoal = typeof campaignGoals.$inferInsert;
