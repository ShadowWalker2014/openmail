/**
 * Workspace lifecycle settings (Stage 3 — T1, [A3.1], CR-07).
 *
 * Per-workspace configuration for burst-send mitigation defaults. Read by:
 *  - Resume API handler when caller omits spread params
 *  - Resume dialog UI to decide whether to surface confirmation prompt
 *  - process-resume-spread worker for default behaviour selection
 *
 * PK = workspace_id (1:1 with workspaces). CASCADE on workspace delete.
 *
 * Defaults map to industry-safe values per [DB-01], [DB-02], [DB-04]:
 *  - resume_dialog_threshold: 100 — midpoint between annoying-for-small-ops
 *    and missing-dangerous-bursts.
 *  - default_spread_window_seconds: 14400 (4h) — Customer.io / mailchimp
 *    safe spread window.
 *  - default_stale_threshold_seconds: 604800 (7d) — Mailchimp/AC effectively
 *    skip-wait at this scale.
 *  - default_resume_mode: 'immediate' — backwards-compat with Stage 2 default.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspaces";

export const RESUME_MODE_VALUES = [
  "immediate",
  "spread",
  "skip_stale",
  "skip_stale_spread",
] as const;

export type ResumeMode = (typeof RESUME_MODE_VALUES)[number];

export const workspaceLifecycleSettings = pgTable(
  "workspace_lifecycle_settings",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    resumeDialogThreshold: integer("resume_dialog_threshold")
      .notNull()
      .default(100),
    defaultSpreadWindowSeconds: integer("default_spread_window_seconds")
      .notNull()
      .default(14400),
    defaultStaleThresholdSeconds: integer("default_stale_threshold_seconds")
      .notNull()
      .default(604800),
    defaultResumeMode: text("default_resume_mode")
      .notNull()
      .default("immediate"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "workspace_lifecycle_settings_resume_mode_check",
      sql.raw(
        `default_resume_mode IN (${RESUME_MODE_VALUES.map(
          (v) => `'${v}'`,
        ).join(", ")})`,
      ),
    ),
    // Sanity bounds — match SPREAD_WINDOW_MIN/MAX_SECONDS from
    // packages/shared/src/lifecycle-constants.ts and 1d/365d for stale.
    check(
      "workspace_lifecycle_settings_spread_window_bounds_check",
      sql`default_spread_window_seconds >= 60 AND default_spread_window_seconds <= ${sql.raw(String(30 * 86400))}`,
    ),
    check(
      "workspace_lifecycle_settings_stale_threshold_bounds_check",
      sql`default_stale_threshold_seconds >= 3600 AND default_stale_threshold_seconds <= ${sql.raw(String(365 * 86400))}`,
    ),
    check(
      "workspace_lifecycle_settings_dialog_threshold_bounds_check",
      sql`resume_dialog_threshold >= 0 AND resume_dialog_threshold <= 1000000`,
    ),
  ],
);

export type WorkspaceLifecycleSettings =
  typeof workspaceLifecycleSettings.$inferSelect;
export type NewWorkspaceLifecycleSettings =
  typeof workspaceLifecycleSettings.$inferInsert;
