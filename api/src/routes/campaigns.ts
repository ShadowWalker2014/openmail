import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { customAlphabet } from "nanoid";
import { getDb } from "@openmail/shared/db";
import { campaigns, campaignSteps } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { RE_ENROLLMENT_POLICY_VALUES, LIFECYCLE_OP_ID_LENGTH } from "@openmail/shared";
import { eq, and, max, count, desc, sql } from "drizzle-orm";
import type { ApiVariables } from "../types.js";
import { cancelCampaignJobs } from "../lib/campaign-cancel.js";
import { logger } from "../lib/logger.js";
import lifecycleRouter from "./campaigns.lifecycle.js";
import stepLifecycleRouter from "./campaign-steps.lifecycle.js";
import goalsRouter from "./campaign-goals.js";
import {
  commitLifecycleStatus,
  IllegalTransitionError,
} from "../../../worker/src/lib/commit-lifecycle-status.js";
import {
  insertEditOutbox,
  isCampaignFrozen,
} from "../lib/campaign-edit-outbox.js";

const app = new Hono<{ Variables: ApiVariables }>();

// Mount lifecycle verb routes (POST /:id/{pause,resume,stop,archive}) at the
// same prefix BEFORE the legacy PATCH/DELETE/etc. handlers so the more-
// specific routes match first. Per Stage 2 T14.
app.route("/", lifecycleRouter);
// Stage 4 — Per-step pause/resume verb routes
// (POST /:id/steps/:stepId/{pause,resume}). Mounted before the legacy step
// CRUD handlers so the verb paths match first.
app.route("/", stepLifecycleRouter);
// Stage 5 — Campaign goals CRUD: GET/POST /:id/goals,
// PATCH/DELETE /:id/goals/:goalId. Mounted before the legacy step CRUD
// handlers so /goals routes match first.
app.route("/", goalsRouter);

// Valid status machine transitions — archived is a terminal state.
//
// Stage 2 [CN-11, A2.10] FROZEN PATCH alias semantics: this map keeps the
// pre-Stage-2 transitions exactly. The new {stopping, stopped} states are
// reachable ONLY through the verb endpoints — PATCH cannot drive them.
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["active", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  stopping: ["archived"],
  stopped: ["archived"],
  archived: [],
};

function parsePagination(pageStr?: string, pageSizeStr?: string) {
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr ?? "50", 10) || 50));
  return { page, pageSize };
}

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { page, pageSize } = parsePagination(c.req.query("page"), c.req.query("pageSize"));
  const db = getDb();
  const [{ total }] = await db.select({ total: count() }).from(campaigns).where(eq(campaigns.workspaceId, workspaceId));
  const data = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.workspaceId, workspaceId))
    .orderBy(desc(campaigns.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return c.json({ data, total, page, pageSize });
});

app.get("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId)))
    .limit(1);
  if (!campaign) return c.json({ error: "Not found" }, 404);
  const steps = await db.select().from(campaignSteps).where(eq(campaignSteps.campaignId, campaign.id));
  return c.json({ ...campaign, steps });
});

/**
 * Stage 3 (T7, REQ-11) — overdue-count endpoint backing the resume dialog.
 *
 * Returns the count + min/max next_run_at of `active` enrollments whose
 * `next_run_at` is in the past. Surfaces three numbers operators want to
 * see BEFORE choosing a resume mode (CR-05).
 *
 * Workspace scope enforced via JOIN to campaigns.
 */
app.get("/:id/overdue-count", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const id = c.req.param("id");
  const db = getDb();

  // Verify campaign membership before exposing counts.
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, workspaceId)))
    .limit(1);
  if (!campaign) return c.json({ error: "Not found" }, 404);

  const rows = (await db.execute(sql`
      SELECT COUNT(*)::int                                AS count,
             MIN(next_run_at)                             AS oldest_scheduled_at,
             MAX(next_run_at)                             AS newest_scheduled_at
        FROM campaign_enrollments
       WHERE campaign_id = ${id}
         AND status = 'active'
         AND next_run_at IS NOT NULL
         AND next_run_at < NOW()
    `)) as unknown as Array<{
    count: number;
    oldest_scheduled_at: Date | string | null;
    newest_scheduled_at: Date | string | null;
  }>;

  const r = rows[0] ?? {
    count: 0,
    oldest_scheduled_at: null,
    newest_scheduled_at: null,
  };
  const toIso = (v: Date | string | null): string | null =>
    v ? (v instanceof Date ? v.toISOString() : new Date(v).toISOString()) : null;
  return c.json({
    count: Number(r.count) || 0,
    oldest_scheduled_at: toIso(r.oldest_scheduled_at),
    newest_scheduled_at: toIso(r.newest_scheduled_at),
  });
});

/**
 * Stage 6 (REQ-09 timeline endpoint) — paginated per-enrollment event history.
 *
 *   GET /api/v1/campaigns/:id/enrollments/:enrollmentId/events
 *     ?limit=50            (1..200, default 50)
 *     &before=<emitted_at> (ISO timestamp; cursor)
 *     &event_types=enrolled,paused,resumed   (CSV; optional)
 *     &include_archive=true                  (UNION with archive)
 *
 * Returns events ordered by event_seq DESC (most recent first). Workspace
 * scope enforced by JOIN through the campaign + enrollment row.
 */
app.get("/:id/enrollments/:enrollmentId/events", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const campaignId = c.req.param("id");
  const enrollmentId = c.req.param("enrollmentId");
  const db = getDb();

  // Verify enrollment + campaign + workspace membership before disclosure.
  const ownership = (await db.execute(sql`
    SELECT e.id, e.workspace_id, e.campaign_id
      FROM campaign_enrollments e
      JOIN campaigns c ON c.id = e.campaign_id
     WHERE e.id = ${enrollmentId}
       AND e.campaign_id = ${campaignId}
       AND c.workspace_id = ${workspaceId}
     LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  if (ownership.length === 0) return c.json({ error: "Not found" }, 404);

  const rawLimit = Number.parseInt(c.req.query("limit") ?? "50", 10);
  const limit = Math.min(200, Math.max(1, isFinite(rawLimit) ? rawLimit : 50));
  const before = c.req.query("before");
  const eventTypesParam = c.req.query("event_types");
  const includeArchive = c.req.query("include_archive") === "true";

  // Build event_types filter array (CSV → trimmed list).
  const eventTypes = eventTypesParam
    ? eventTypesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  // The query is constructed via separate SQL fragments because parameterized
  // ANY(text[]) requires an array literal binding which `drizzle-orm`'s sql
  // tag handles for typed arrays — we use a JSON array round-trip for safety.
  const beforeDate = before ? new Date(before) : null;
  const useArchive = includeArchive;

  const primary = (await db.execute(sql`
    SELECT id, enrollment_id, campaign_id, contact_id, workspace_id,
           event_type, payload_version, payload, "before", "after",
           actor, event_seq, emitted_at, false AS from_archive
      FROM enrollment_events
     WHERE enrollment_id = ${enrollmentId}
       AND workspace_id = ${workspaceId}
       ${beforeDate ? sql`AND emitted_at < ${beforeDate}` : sql``}
       ${eventTypes && eventTypes.length > 0
         ? sql`AND event_type = ANY(${eventTypes}::text[])`
         : sql``}
     ORDER BY event_seq DESC NULLS LAST, emitted_at DESC
     LIMIT ${limit}
  `)) as unknown as Array<Record<string, unknown>>;

  let events = primary;
  if (useArchive) {
    const archive = (await db.execute(sql`
      SELECT id, enrollment_id, campaign_id, contact_id, workspace_id,
             event_type, payload_version, payload, "before", "after",
             actor, event_seq, emitted_at, true AS from_archive
        FROM enrollment_events_archive
       WHERE enrollment_id = ${enrollmentId}
         AND workspace_id = ${workspaceId}
         ${beforeDate ? sql`AND emitted_at < ${beforeDate}` : sql``}
         ${eventTypes && eventTypes.length > 0
           ? sql`AND event_type = ANY(${eventTypes}::text[])`
           : sql``}
       ORDER BY event_seq DESC NULLS LAST, emitted_at DESC
       LIMIT ${limit}
    `)) as unknown as Array<Record<string, unknown>>;
    // Merge + sort + truncate.
    events = [...primary, ...archive]
      .sort((a, b) => {
        const aSeq = a.event_seq != null ? BigInt(a.event_seq as string) : null;
        const bSeq = b.event_seq != null ? BigInt(b.event_seq as string) : null;
        if (aSeq != null && bSeq != null) {
          if (aSeq > bSeq) return -1;
          if (aSeq < bSeq) return 1;
          return 0;
        }
        const ad = a.emitted_at instanceof Date
          ? a.emitted_at.getTime()
          : new Date(a.emitted_at as string).getTime();
        const bd = b.emitted_at instanceof Date
          ? b.emitted_at.getTime()
          : new Date(b.emitted_at as string).getTime();
        return bd - ad;
      })
      .slice(0, limit);
  }

  // Compute next-cursor (oldest emitted_at in returned set).
  let nextBefore: string | null = null;
  if (events.length === limit) {
    const last = events[events.length - 1];
    const ts = last.emitted_at;
    nextBefore =
      ts instanceof Date ? ts.toISOString() : new Date(ts as string).toISOString();
  }

  return c.json({
    data: events,
    pagination: {
      limit,
      hasMore: events.length === limit,
      nextBefore,
    },
  });
});

// Stage 2 [V2.3]: re_enrollment_policy + cooldown fields. Cross-field
// refinement: when policy === "after_cooldown", cooldown_seconds is REQUIRED.
const reEnrollmentPolicySchema = z
  .object({
    re_enrollment_policy: z
      .enum(RE_ENROLLMENT_POLICY_VALUES)
      .default("never"),
    re_enrollment_cooldown_seconds: z.number().int().positive().optional(),
  })
  .refine(
    (v) =>
      v.re_enrollment_policy !== "after_cooldown" ||
      typeof v.re_enrollment_cooldown_seconds === "number",
    {
      message:
        "re_enrollment_cooldown_seconds is required when re_enrollment_policy is 'after_cooldown'",
      path: ["re_enrollment_cooldown_seconds"],
    },
  );

app.post(
  "/",
  zValidator(
    "json",
    z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        triggerType: z.enum(["event", "segment_enter", "segment_exit", "manual"]),
        triggerConfig: z.record(z.unknown()).optional().default({}),
        re_enrollment_policy: z
          .enum(RE_ENROLLMENT_POLICY_VALUES)
          .default("never"),
        re_enrollment_cooldown_seconds: z.number().int().positive().optional(),
      })
      .refine(
        (v) =>
          v.re_enrollment_policy !== "after_cooldown" ||
          typeof v.re_enrollment_cooldown_seconds === "number",
        {
          message:
            "re_enrollment_cooldown_seconds is required when re_enrollment_policy is 'after_cooldown'",
          path: ["re_enrollment_cooldown_seconds"],
        },
      ),
  ),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const body = c.req.valid("json");
    const db = getDb();

    // Validate that required triggerConfig keys are present for each trigger type.
    if ((body.triggerType === "segment_enter" || body.triggerType === "segment_exit") && !body.triggerConfig?.segmentId) {
      return c.json({ error: `triggerConfig.segmentId is required for triggerType "${body.triggerType}"` }, 400);
    }
    if (body.triggerType === "event" && !body.triggerConfig?.eventName) {
      return c.json({ error: 'triggerConfig.eventName is required for triggerType "event"' }, 400);
    }

    // Map snake_case body fields to Drizzle camelCase column names.
    const { re_enrollment_policy, re_enrollment_cooldown_seconds, ...rest } = body;
    const [campaign] = await db
      .insert(campaigns)
      .values({
        id: generateId("cmp"),
        workspaceId,
        ...rest,
        reEnrollmentPolicy: re_enrollment_policy,
        reEnrollmentCooldownSeconds: re_enrollment_cooldown_seconds ?? null,
      })
      .returning();
    return c.json(campaign, 201);
  },
);
void reEnrollmentPolicySchema; // re-exported via the inline body schema; kept for future composition

// 12-char alphanumeric op-id alphabet — matches packages/shared/src/ids.ts so
// PATCH alias op-ids share format with verb-handler / MCP op-ids.
const patchOpIdAlphabet = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  LIFECYCLE_OP_ID_LENGTH,
);

/**
 * PATCH /campaigns/:id
 *
 * Stage 2 [CN-11, A2.10] — FROZEN ALIAS for the pre-Stage-2 PATCH-status
 * pattern. Response shape is preserved (raw campaign row + X-Deprecated
 * header). Internally, status mutations now route through
 * `commitLifecycleStatus()` so the Postgres `audit_chokepoint_check` trigger
 * (migration 0007) admits the UPDATE and the audit log records every flip.
 *
 * Mapping:
 *   {status: "paused"}                 → commitLifecycleStatus active → paused
 *   {status: "active"} from paused     → commitLifecycleStatus paused → active
 *   {status: "active"} from draft      → direct UPDATE (no audit event for
 *                                        draft→active in Stage 2; treated as
 *                                        manual_status_override aggregate)
 *   {status: "archived"}               → commitLifecycleStatus * → archived
 *   {status: "draft"}                  → direct UPDATE (no campaign-status
 *                                        event_type for draft); not audited
 *   {status: "stopping"|"stopped"}     → HTTP 400 (PATCH cannot stop)
 *
 * The audit emit uses `eventTypeOverride: "manual_status_override"` for any
 * transition that doesn't have a canonical mapping — preserves the chokepoint
 * contract while tagging the source as a deprecated PATCH.
 *
 * Post-Stage-2: a future major version will REMOVE the PATCH-status alias
 * entirely. Until then, PATCH MUST flow through commitLifecycleStatus so the
 * audit chokepoint trigger does not throw `lifecycle.audit_chokepoint`.
 */
app.patch(
  "/:id",
  zValidator(
    "json",
    z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
        status: z
          .enum([
            "draft",
            "active",
            "paused",
            "stopping",
            "stopped",
            "archived",
          ])
          .optional(),
        triggerConfig: z.record(z.unknown()).optional(),
        re_enrollment_policy: z
          .enum(RE_ENROLLMENT_POLICY_VALUES)
          .optional(),
        re_enrollment_cooldown_seconds: z.number().int().positive().optional(),
      })
      .refine(
        (v) =>
          v.re_enrollment_policy !== "after_cooldown" ||
          typeof v.re_enrollment_cooldown_seconds === "number",
        {
          message:
            "re_enrollment_cooldown_seconds is required when re_enrollment_policy is 'after_cooldown'",
          path: ["re_enrollment_cooldown_seconds"],
        },
      ),
  ),
  async (c) => {
    // Mark every PATCH response with the deprecation header per [V2.10] /
    // task spec. Self-hosters discover this via API responses.
    c.header(
      "X-Deprecated",
      "Use POST /api/v1/campaigns/:id/{pause,resume,stop,archive} instead",
    );

    const workspaceId = c.get("workspaceId") as string;
    const db = getDb();
    const body = c.req.valid("json");

    // Pre-fetch so we can validate the status transition before mutating.
    const [existing] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId)))
      .limit(1);
    if (!existing) return c.json({ error: "Not found" }, 404);

    // Stage 2 [A2.10]: PATCH cannot drive the new {stopping, stopped} states.
    // Operators must use POST /:id/stop (drain or force) instead.
    if (body.status === "stopping" || body.status === "stopped") {
      return c.json(
        {
          error:
            "PATCH cannot transition to 'stopping' or 'stopped'. Use POST /api/v1/campaigns/:id/stop with { mode: 'drain' | 'force' }.",
        },
        400,
      );
    }

    // [CR-13] PATCH on stopping/stopped is allowed only for archive; other
    // status changes from these states return 409.
    if (
      (existing.status === "stopping" || existing.status === "stopped") &&
      body.status &&
      (body.status as string) !== existing.status &&
      body.status !== "archived"
    ) {
      return c.json(
        {
          error: "INVALID_TRANSITION",
          from: existing.status,
          to: body.status,
        },
        409,
      );
    }

    if (body.status && body.status !== existing.status) {
      const allowed = VALID_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(body.status)) {
        return c.json(
          { error: `Invalid status transition from "${existing.status}" to "${body.status}"` },
          400
        );
      }
      if (body.status === "active") {
        const [firstStep] = await db
          .select({ id: campaignSteps.id })
          .from(campaignSteps)
          .where(eq(campaignSteps.campaignId, c.req.param("id")))
          .limit(1);
        if (!firstStep) return c.json({ error: "Cannot activate a campaign with no steps" }, 400);
      }
    }

    // Map snake_case re_enrollment_* body fields → camelCase columns.
    const {
      re_enrollment_policy,
      re_enrollment_cooldown_seconds,
      status: _bodyStatus,
      ...nonStatusFields
    } = body;

    // Build the non-status update payload. We split status-mutation out so it
    // can route through commitLifecycleStatus() — required after migration
    // 0007's audit_chokepoint trigger lands. Non-status fields are still a
    // direct UPDATE since the trigger only fires on status changes.
    const nonStatusUpdate: Record<string, unknown> = {
      ...nonStatusFields,
      updatedAt: new Date(),
    };
    if (re_enrollment_policy !== undefined) {
      nonStatusUpdate.reEnrollmentPolicy = re_enrollment_policy;
    }
    if (re_enrollment_cooldown_seconds !== undefined) {
      nonStatusUpdate.reEnrollmentCooldownSeconds = re_enrollment_cooldown_seconds;
    }

    const statusChanging = body.status && body.status !== existing.status;
    const lifecycleOpId = `lop_patch_${patchOpIdAlphabet()}`;
    const userId = c.get("userId") as string | undefined;
    const apiKeyId = (c.get as (k: string) => unknown)("apiKeyId") as
      | string
      | undefined;
    const actor = apiKeyId
      ? ({ kind: "agent_key", apiKeyId } as const)
      : userId
        ? ({ kind: "user", userId } as const)
        : ({ kind: "system" } as const);

    if (statusChanging) {
      const fromStatus = existing.status;
      const toStatus = body.status as string;

      // Route status mutations through commitLifecycleStatus so the
      // audit_chokepoint trigger admits the UPDATE and the transition is
      // recorded in enrollment_events. Wrap the non-status UPDATE in the
      // same tx so the whole PATCH is atomic.
      try {
        await db.transaction(async (tx) => {
          // 1) Apply the non-status fields first (still inside the tx; the
          //    trigger only fires WHEN OF (status), so a no-status UPDATE on
          //    other columns passes regardless of the GUC).
          if (Object.keys(nonStatusUpdate).length > 1) {
            await tx
              .update(campaigns)
              .set(nonStatusUpdate)
              .where(
                and(
                  eq(campaigns.id, c.req.param("id")),
                  eq(campaigns.workspaceId, workspaceId),
                ),
              );
          }

          // 2) Commit the status transition. Use eventTypeOverride =
          //    "manual_status_override" for any flip that doesn't map cleanly
          //    to a canonical event_type (e.g. draft→active, draft→archived).
          //    For paused/active/archived from their canonical sources, let
          //    commitLifecycleStatus pick the default event type so audit
          //    consumers see the same event_type as the verb endpoint emits.
          let eventTypeOverride: "manual_status_override" | undefined;
          const canonical =
            (toStatus === "paused" && fromStatus === "active") ||
            (toStatus === "active" && fromStatus === "paused") ||
            toStatus === "archived";
          if (!canonical) {
            // draft→active, draft→archived, paused→archived... all of these
            // are valid VALID_TRANSITIONS but don't have a canonical event
            // type. Tag as manual_status_override so audit log differentiates.
            eventTypeOverride = "manual_status_override";
          }

          await commitLifecycleStatus(
            tx,
            "campaigns",
            c.req.param("id"),
            fromStatus,
            toStatus,
            {
              lifecycleOpId,
              actor,
              workspaceId,
              eventTypeOverride,
              extraPayload: { source: "patch_alias" },
            },
          );
        });
      } catch (err) {
        if (err instanceof IllegalTransitionError) {
          // Should not happen — we already validated transitions above —
          // but if a race interleaves, surface a 409 the same way the verb
          // endpoints do.
          return c.json(
            {
              error: "INVALID_TRANSITION",
              from: err.expectedFrom,
              to: err.attemptedTo,
              actual: err.actualStatus,
            },
            409,
          );
        }
        throw err;
      }

      // After commit: cancel any in-flight enrollment jobs (CR-04). Same
      // semantics as the verb-handler post-commit cancellation.
      if (toStatus === "paused" && fromStatus === "active") {
        const { cancelled } = await cancelCampaignJobs(c.req.param("id"), "paused");
        logger.info({ campaignId: c.req.param("id"), fromStatus, toStatus, cancelledCount: cancelled, lifecycle_op_id: lifecycleOpId }, "Campaign paused via PATCH alias: enrollment jobs cancelled");
      } else if (toStatus === "archived") {
        const { cancelled } = await cancelCampaignJobs(c.req.param("id"), "cancelled");
        logger.info({ campaignId: c.req.param("id"), fromStatus, toStatus, cancelledCount: cancelled, lifecycle_op_id: lifecycleOpId }, "Campaign archived via PATCH alias: enrollment jobs cancelled");
      }
    } else if (Object.keys(nonStatusUpdate).length > 1) {
      // Non-status update only — no audit event needed.
      await db
        .update(campaigns)
        .set(nonStatusUpdate)
        .where(
          and(
            eq(campaigns.id, c.req.param("id")),
            eq(campaigns.workspaceId, workspaceId),
          ),
        );
    }

    // Re-read the campaign for the response (preserves original shape).
    const [updated] = await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, c.req.param("id")),
          eq(campaigns.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return c.json(updated);
  }
);

app.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();

  const [existing] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) return c.json({ error: "Not found" }, 404);
  if (existing.status === "active") {
    return c.json({ error: "Cannot delete an active campaign. Pause or archive it first." }, 400);
  }

  // Cancel queued step-execution jobs BEFORE deleting the campaign — the FK
  // cascade will remove enrollment rows but BullMQ jobs in Redis are not
  // cascade-deleted. Idempotent: any rows already in non-active status are
  // skipped by the helper. No-op if no enrollments exist.
  const { cancelled } = await cancelCampaignJobs(c.req.param("id"), "cancelled");
  logger.info({ campaignId: c.req.param("id"), fromStatus: existing.status, toStatus: "deleted", cancelledCount: cancelled }, "Campaign deleted: enrollment jobs cancelled");

  await db.delete(campaigns).where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId)));
  return c.json({ success: true });
});

app.post("/:id/steps", zValidator("json", z.object({
  stepType: z.enum(["email", "wait"]),
  config: z.record(z.unknown()).default({}),
  position: z.number().int().min(0).optional(),
})), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId)))
    .limit(1);
  if (!campaign) return c.json({ error: "Not found" }, 404);
  // Stage 6 [REQ-28]: reject edits on frozen campaigns.
  if (isCampaignFrozen(campaign.status)) {
    return c.json(
      { error: "Campaign is in a frozen status; edits are not allowed", status: campaign.status },
      409,
    );
  }
  // Pre-Stage-6 invariant retained: pre-launch step inserts only allowed on
  // draft. For active/paused: legitimate "step_inserted" mid-flight requires
  // separate semantics (out of scope this stage — emit outbox row anyway so
  // future-Stage UI can render reconciliation lineage).
  if (campaign.status !== "draft" && campaign.status !== "active" && campaign.status !== "paused") {
    return c.json({ error: "Cannot add steps to campaign in this status" }, 400);
  }

  const body = c.req.valid("json");
  let position = body.position;
  if (position === undefined) {
    // Use MAX(position) + 1 to avoid gaps left by deletions and to be
    // more robust than counting rows (though still not perfectly atomic).
    const [{ maxPos }] = await db
      .select({ maxPos: max(campaignSteps.position) })
      .from(campaignSteps)
      .where(eq(campaignSteps.campaignId, campaign.id));
    position = (maxPos ?? -1) + 1;
  }

  // Stage 6 [CR-11]: data write + outbox write in the same db.transaction().
  const lifecycleOpId = `lop_step_ins_${customAlphabet(
    "0123456789abcdefghijklmnopqrstuvwxyz",
    LIFECYCLE_OP_ID_LENGTH,
  )()}`;
  const stepId = generateId("stp");
  const finalPosition = position;
  const [step] = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(campaignSteps)
      .values({ id: stepId, campaignId: campaign.id, workspaceId, stepType: body.stepType, config: body.config, position: finalPosition })
      .returning();
    // Only emit step_inserted to outbox if campaign is past draft (mid-flight
    // enrollments may need reconciliation). Draft campaigns have no in-flight
    // enrollments so skipping is safe.
    if (campaign.status !== "draft") {
      await insertEditOutbox(tx, {
        workspaceId,
        campaignId: campaign.id,
        editType: "step_inserted",
        details: { stepId, position: finalPosition, stepType: body.stepType },
        lifecycleOpId,
      });
    }
    return [s];
  });
  return c.json(step, 201);
});

app.patch("/:id/steps/:stepId", zValidator("json", z.object({
  config: z.record(z.unknown()).optional(),
  position: z.number().int().min(0).optional(),
})), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const campaignId = c.req.param("id");
  const stepId = c.req.param("stepId");
  const db = getDb();
  const body = c.req.valid("json");

  // Stage 6 [REQ-28]: load campaign + reject frozen.
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)))
    .limit(1);
  if (!campaign) return c.json({ error: "Not found" }, 404);
  if (isCampaignFrozen(campaign.status)) {
    return c.json(
      { error: "Campaign is in a frozen status; edits are not allowed", status: campaign.status },
      409,
    );
  }
  const [oldStep] = await db
    .select()
    .from(campaignSteps)
    .where(and(eq(campaignSteps.id, stepId), eq(campaignSteps.campaignId, campaignId), eq(campaignSteps.workspaceId, workspaceId)))
    .limit(1);
  if (!oldStep) return c.json({ error: "Not found" }, 404);

  // Detect edit type for outbox emission.
  let editType: "wait_duration_changed" | "email_template_changed" | null = null;
  let details: Record<string, unknown> = { stepId };
  if (body.config) {
    if (oldStep.stepType === "wait") {
      const oldCfg = (oldStep.config ?? {}) as { duration?: number; unit?: string };
      const newCfg = body.config as { duration?: number; unit?: string };
      const unitMs: Record<string, number> = { hours: 3600, days: 86400, weeks: 7 * 86400 };
      const oldSecs = (oldCfg.duration ?? 0) * (unitMs[oldCfg.unit ?? ""] ?? 0);
      const newSecs = (newCfg.duration ?? 0) * (unitMs[newCfg.unit ?? ""] ?? 0);
      if (oldSecs !== newSecs) {
        editType = "wait_duration_changed";
        details = { stepId, oldDelaySeconds: oldSecs, newDelaySeconds: newSecs };
      }
    } else if (oldStep.stepType === "email") {
      const oldT = ((oldStep.config ?? {}) as { templateId?: string }).templateId;
      const newT = (body.config as { templateId?: string }).templateId;
      if (oldT !== newT) {
        editType = "email_template_changed";
        details = { stepId, oldTemplateId: oldT, newTemplateId: newT };
      }
    }
  }

  const lifecycleOpId = `lop_step_pat_${customAlphabet(
    "0123456789abcdefghijklmnopqrstuvwxyz",
    LIFECYCLE_OP_ID_LENGTH,
  )()}`;

  const [step] = await db.transaction(async (tx) => {
    const [s] = await tx
      .update(campaignSteps)
      .set({ ...body })
      .where(and(
        eq(campaignSteps.id, stepId),
        eq(campaignSteps.campaignId, campaignId),
        eq(campaignSteps.workspaceId, workspaceId),
      ))
      .returning();
    if (editType) {
      await insertEditOutbox(tx, {
        workspaceId,
        campaignId,
        editType,
        details,
        lifecycleOpId,
      });
    }
    return [s];
  });
  if (!step) return c.json({ error: "Not found" }, 404);
  return c.json(step);
});

app.delete("/:id/steps/:stepId", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const campaignId = c.req.param("id");
  const stepId = c.req.param("stepId");
  const db = getDb();

  // Stage 6 [REQ-28]: reject delete on frozen campaigns.
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)))
    .limit(1);
  if (!campaign) return c.json({ error: "Not found" }, 404);
  if (isCampaignFrozen(campaign.status)) {
    return c.json(
      { error: "Campaign is in a frozen status; edits are not allowed", status: campaign.status },
      409,
    );
  }

  // Stage 4 (CR-07, REQ-16): If the step being deleted is paused AND has held
  // enrollments, advance them past the step BEFORE deletion. We read step state
  // first so we can decide whether reconciliation is needed.
  const [step] = await db
    .select()
    .from(campaignSteps)
    .where(
      and(
        eq(campaignSteps.id, stepId),
        eq(campaignSteps.campaignId, campaignId),
        eq(campaignSteps.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!step) return c.json({ error: "Not found" }, 404);

  const lifecycleOpId = `lop_step_del_${customAlphabet(
    "0123456789abcdefghijklmnopqrstuvwxyz",
    LIFECYCLE_OP_ID_LENGTH,
  )()}`;
  const userId = c.get("userId") as string | undefined;
  const apiKeyId = (c.get as unknown as (k: string) => unknown)("apiKeyId") as
    | string
    | undefined;
  const actor =
    apiKeyId
      ? ({ kind: "agent_key" as const, apiKeyId })
      : userId
        ? ({ kind: "user" as const, userId })
        : ({ kind: "system" as const });

  let advancedCount = 0;
  if (step.status === "paused") {
    // Lazy-load the helper (worker-side) at call time to avoid module-import
    // cycles at boot.
    const { readAndAuditHeldEnrollmentsForStep, advanceEnrollmentsPastStepAfterCommit } =
      await import("../../../worker/src/lib/advance-enrollments-past-step.js");

    let heldResult: Awaited<
      ReturnType<typeof readAndAuditHeldEnrollmentsForStep>
    > = { advanced: [] };

    await db.transaction(async (tx) => {
      // Audit chokepoint pass.
      await tx.execute(sql`SET LOCAL lifecycle.audited_tx = 'true'`);

      heldResult = await readAndAuditHeldEnrollmentsForStep(tx, {
        campaignId,
        workspaceId,
        stepId,
        deletedStepPosition: step.position,
        lifecycleOpId,
        actor,
        reason: "step_deleted_while_paused",
      });

      // Delete step inside same tx — audit + delete atomic.
      await tx
        .delete(campaignSteps)
        .where(
          and(
            eq(campaignSteps.id, stepId),
            eq(campaignSteps.campaignId, campaignId),
            eq(campaignSteps.workspaceId, workspaceId),
          ),
        );

      // Stage 6 [CR-11]: outbox emission for step_deleted in same tx.
      await insertEditOutbox(tx, {
        workspaceId,
        campaignId,
        editType: "step_deleted",
        details: { stepId, position: step.position },
        lifecycleOpId,
      });
    });

    // After commit, advance each enrollment past the deleted position.
    const advanceStats = await advanceEnrollmentsPastStepAfterCommit(
      db,
      heldResult,
      {
        campaignId,
        workspaceId,
        stepId,
        deletedStepPosition: step.position,
        lifecycleOpId,
        actor,
        reason: "step_deleted_while_paused",
      },
    );
    advancedCount = advanceStats.advanced;

    return c.json({
      success: true,
      reconciled: true,
      advanced_count: advancedCount,
      lifecycle_op_id: lifecycleOpId,
    });
  }

  // Non-paused step: simple delete with outbox emission (Stage 6 [CR-11]).
  const lifecycleOpIdNp = `lop_step_del_${customAlphabet(
    "0123456789abcdefghijklmnopqrstuvwxyz",
    LIFECYCLE_OP_ID_LENGTH,
  )()}`;
  const deleted = await db.transaction(async (tx) => {
    const [d] = await tx
      .delete(campaignSteps)
      .where(
        and(
          eq(campaignSteps.id, stepId),
          eq(campaignSteps.campaignId, campaignId),
          eq(campaignSteps.workspaceId, workspaceId),
        ),
      )
      .returning({ id: campaignSteps.id });
    if (d) {
      await insertEditOutbox(tx, {
        workspaceId,
        campaignId,
        editType: "step_deleted",
        details: { stepId, position: step.position },
        lifecycleOpId: lifecycleOpIdNp,
      });
    }
    return d;
  });
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true, lifecycle_op_id: lifecycleOpIdNp });
});

/**
 * POST /:id/edits/preview
 *
 * Stage 7 follow-up — Reconciliation preview.
 *
 * Returns the projected impact of a proposed edit WITHOUT writing
 * anything. The dashboard uses this to render a confirmation dialog:
 * "12,847 enrollments are at this step. If you save, 8,200 will fire
 * IMMEDIATELY, 3,600 spread over 4h, 1,047 skip-stale. We recommend
 * `skip_stale_spread` mode."
 *
 * Body (discriminated by `edit_type`):
 *   { edit_type: "wait_duration_changed",
 *     step_id: "stp_xxx",
 *     new_delay_seconds: 86400,
 *     old_delay_seconds?: number    // optional; computed if omitted
 *   }
 *   { edit_type: "step_deleted", step_id: "stp_xxx" }
 *   { edit_type: "step_inserted" | "email_template_changed" |
 *                "goal_added" | "goal_updated" | "goal_removed", ... }
 *
 * Response: 200 with the EditImpact JSON; 409 if campaign is frozen
 * (mirrors REQ-28 — preview rejects frozen campaigns the same way the
 * actual edit handler does, so the operator sees a consistent error
 * before saving).
 *
 * READ-ONLY. No DB writes. Safe to call from the dashboard at any time
 * (e.g. on every keystroke as the operator edits the duration field).
 */
const previewSchema = z.discriminatedUnion("edit_type", [
  z.object({
    edit_type: z.literal("wait_duration_changed"),
    step_id: z.string(),
    new_delay_seconds: z.number().int().positive(),
    old_delay_seconds: z.number().int().nonnegative().optional(),
  }),
  z.object({
    edit_type: z.literal("step_deleted"),
    step_id: z.string(),
  }),
  z.object({
    edit_type: z.literal("step_inserted"),
  }),
  z.object({
    edit_type: z.literal("email_template_changed"),
    step_id: z.string().optional(),
    new_template_id: z.string().optional(),
  }),
  z.object({
    edit_type: z.literal("goal_added"),
  }),
  z.object({
    edit_type: z.literal("goal_updated"),
  }),
  z.object({
    edit_type: z.literal("goal_removed"),
  }),
]);

app.post(
  "/:id/edits/preview",
  zValidator("json", previewSchema),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const campaignId = c.req.param("id");
    const body = c.req.valid("json");
    // Lazy-import the worker helper. This API process must NOT pull the
    // worker boot path at module-load — keeping the import inside the
    // handler avoids accidentally starting BullMQ workers in the api.
    const {
      previewEdit,
      getCampaignStatus,
      getWaitStepDelay,
    } = await import("../../../worker/src/lib/edit-impact.js");

    // Mirror REQ-28: reject preview on frozen campaigns the same way the
    // actual save would, so operator UX is consistent.
    const status = await getCampaignStatus(campaignId, workspaceId);
    if (status === null) return c.json({ error: "Not found" }, 404);
    if (isCampaignFrozen(status)) {
      return c.json(
        {
          error:
            "Campaign is in a frozen status; edits and previews are not allowed",
          status,
        },
        409,
      );
    }

    let details: Record<string, unknown>;
    if (body.edit_type === "wait_duration_changed") {
      let oldDelay = body.old_delay_seconds;
      if (oldDelay === undefined) {
        const got = await getWaitStepDelay(campaignId, body.step_id);
        oldDelay = got ?? 0;
      }
      details = {
        stepId: body.step_id,
        oldDelaySeconds: oldDelay,
        newDelaySeconds: body.new_delay_seconds,
      };
    } else if (body.edit_type === "step_deleted") {
      details = { stepId: body.step_id };
    } else {
      details = {};
    }

    const impact = await previewEdit({
      workspaceId,
      campaignId,
      editType: body.edit_type,
      details,
    });
    return c.json({ data: impact });
  },
);

export default app;
