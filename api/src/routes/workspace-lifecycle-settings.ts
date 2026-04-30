/**
 * Workspace lifecycle settings API (Stage 3 — T9, REQ-19, CR-07).
 *
 * GET  /workspace/lifecycle-settings  → current settings (or defaults)
 * PATCH /workspace/lifecycle-settings → upsert (workspace owner/admin only)
 *
 * Mounted under /api/session/ws/:workspaceId so workspace-membership middleware
 * already enforces auth. Role gate (owner/admin) checked here.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import {
  workspaceLifecycleSettings,
  RESUME_MODE_VALUES,
} from "@openmail/shared/schema";
import {
  SPREAD_WINDOW_MIN_SECONDS,
  SPREAD_WINDOW_MAX_SECONDS,
} from "@openmail/shared";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

const DEFAULTS = {
  resumeDialogThreshold: 100,
  defaultSpreadWindowSeconds: 14400,
  defaultStaleThresholdSeconds: 604800,
  defaultResumeMode: "immediate" as const,
};

function isAdminOrOwner(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [row] = await db
    .select()
    .from(workspaceLifecycleSettings)
    .where(eq(workspaceLifecycleSettings.workspaceId, workspaceId))
    .limit(1);
  if (!row) {
    return c.json({
      workspaceId,
      ...DEFAULTS,
      isDefault: true,
    });
  }
  return c.json({
    workspaceId: row.workspaceId,
    resumeDialogThreshold: row.resumeDialogThreshold,
    defaultSpreadWindowSeconds: row.defaultSpreadWindowSeconds,
    defaultStaleThresholdSeconds: row.defaultStaleThresholdSeconds,
    defaultResumeMode: row.defaultResumeMode,
    isDefault: false,
  });
});

const patchSchema = z
  .object({
    resumeDialogThreshold: z.number().int().min(0).max(1_000_000).optional(),
    defaultSpreadWindowSeconds: z
      .number()
      .int()
      .min(SPREAD_WINDOW_MIN_SECONDS)
      .max(SPREAD_WINDOW_MAX_SECONDS)
      .optional(),
    defaultStaleThresholdSeconds: z
      .number()
      .int()
      .min(3600)
      .max(365 * 86400)
      .optional(),
    defaultResumeMode: z.enum(RESUME_MODE_VALUES).optional(),
  })
  .strict();

app.patch("/", zValidator("json", patchSchema), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  // Member set by sessionApi /ws/:workspaceId/* guard.
  const member = c.get("workspaceMember") as { role?: string } | undefined;
  if (!isAdminOrOwner(member?.role)) {
    return c.json({ error: "Forbidden — owner/admin required" }, 403);
  }

  const body = c.req.valid("json");
  const db = getDb();

  // Upsert: insert with workspaceId + provided fields (defaults fill the rest);
  // on conflict, update the provided fields only.
  await db.execute(sql`
    INSERT INTO workspace_lifecycle_settings (
      workspace_id,
      resume_dialog_threshold,
      default_spread_window_seconds,
      default_stale_threshold_seconds,
      default_resume_mode,
      created_at,
      updated_at
    ) VALUES (
      ${workspaceId},
      ${body.resumeDialogThreshold ?? DEFAULTS.resumeDialogThreshold},
      ${body.defaultSpreadWindowSeconds ?? DEFAULTS.defaultSpreadWindowSeconds},
      ${body.defaultStaleThresholdSeconds ?? DEFAULTS.defaultStaleThresholdSeconds},
      ${body.defaultResumeMode ?? DEFAULTS.defaultResumeMode},
      NOW(),
      NOW()
    )
    ON CONFLICT (workspace_id) DO UPDATE SET
      resume_dialog_threshold        = COALESCE(${body.resumeDialogThreshold ?? null}, workspace_lifecycle_settings.resume_dialog_threshold),
      default_spread_window_seconds  = COALESCE(${body.defaultSpreadWindowSeconds ?? null}, workspace_lifecycle_settings.default_spread_window_seconds),
      default_stale_threshold_seconds= COALESCE(${body.defaultStaleThresholdSeconds ?? null}, workspace_lifecycle_settings.default_stale_threshold_seconds),
      default_resume_mode            = COALESCE(${body.defaultResumeMode ?? null}, workspace_lifecycle_settings.default_resume_mode),
      updated_at                     = NOW()
  `);

  const [row] = await db
    .select()
    .from(workspaceLifecycleSettings)
    .where(eq(workspaceLifecycleSettings.workspaceId, workspaceId))
    .limit(1);
  if (!row) {
    return c.json({ error: "Failed to upsert" }, 500);
  }
  return c.json({
    workspaceId: row.workspaceId,
    resumeDialogThreshold: row.resumeDialogThreshold,
    defaultSpreadWindowSeconds: row.defaultSpreadWindowSeconds,
    defaultStaleThresholdSeconds: row.defaultStaleThresholdSeconds,
    defaultResumeMode: row.defaultResumeMode,
    isDefault: false,
  });
});

export default app;
