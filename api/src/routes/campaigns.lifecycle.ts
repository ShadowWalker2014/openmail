/**
 * Lifecycle verb route handlers (Stage 2 — T13, REQ-04, [CR-13], [CR-15]).
 *
 * Mounted at the same prefix as the existing campaigns router. Adds the four
 * explicit verb endpoints that replace the implicit PATCH-status pattern:
 *
 *   POST /api/v1/campaigns/:id/pause
 *   POST /api/v1/campaigns/:id/resume     body: { mode: "immediate" }
 *   POST /api/v1/campaigns/:id/stop       body: { mode: "drain" | "force", confirm_force? }
 *   POST /api/v1/campaigns/:id/archive    body: { confirm_terminal: true }
 *
 * Each handler:
 *   1. Generates a `lifecycle_op_id` (12-char nanoid prefixed `lop_api_`) at the
 *      operation boundary, OR reads `X-Lifecycle-Op-Id` request header when
 *      forwarded by an upstream caller (MCP tool / SDK). Per [CR-15].
 *   2. Wraps the mutation in `db.transaction()` so the UPDATE and the audit
 *      `enrollment_events` INSERT live in one atomic boundary (CR-01).
 *   3. Calls `commitLifecycleStatus()` from the worker package — the single
 *      chokepoint that handles transition assertion, GUC, UPDATE, and audit
 *      emission. Throws `IllegalTransitionError` on illegal transitions.
 *   4. Maps `IllegalTransitionError` → HTTP 409 with `{error,from,to,actual}`
 *      per [CR-03].
 *   5. Pino logs `{campaignId, verb, mode, durationMs, lifecycle_op_id}` after
 *      commit using `logger.child({lifecycle_op_id})` for request-scoped binding.
 *
 * Terminal-state policy [CR-13]:
 *   - All verbs except `archive` return HTTP 409 INVALID_TRANSITION on
 *     {stopped, archived}. The state machine assertion in commitLifecycleStatus
 *     enforces this naturally (current!=expectedFrom → IllegalTransitionError).
 *   - `archive` on `archived` returns HTTP 200 (idempotent).
 *
 * Stop semantics:
 *   - `mode: "drain"` — flips `active|paused → stopping` then the BullMQ
 *     `lifecycle-drain-sweeper` (Stage 2 T12) promotes `stopping → stopped`
 *     when no progressing enrollments remain. Single-flight per campaign.
 *   - `mode: "force"` — calls `cancelCampaignJobs(id, "cancelled")` from
 *     Stage 1 (exact-jobId, no SCAN — CN-08), then commits `* → stopped`.
 *     `confirm_force: true` literal REQUIRED in body to prevent accidents.
 *
 * The `resume` handler accepts ONLY `mode: "immediate"` in Stage 2 — the
 * mode parameter is forward-compatible: Stage 3 will extend with
 * `mode: "spread" | "skip_stale"` per [A2.11]. Anything else throws 400.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { getDb } from "@openmail/shared/db";
import {
  campaigns,
  campaignEnrollments,
  workspaceLifecycleSettings,
} from "@openmail/shared/schema";
import {
  LIFECYCLE_OP_ID_LENGTH,
  SPREAD_WINDOW_MIN_SECONDS,
  SPREAD_WINDOW_MAX_SECONDS,
} from "@openmail/shared";
import {
  commitLifecycleStatus,
  IllegalTransitionError,
  type CommitAuditCtx,
} from "../../../worker/src/lib/commit-lifecycle-status.js";
import { audit } from "../../../worker/src/lib/lifecycle-audit.js";
import {
  acquireResumeLock,
  releaseResumeLock,
  readRateLimitConfig,
  RateLimitConfigMissingError,
  getResumeSpreadQueue,
  RESUME_SPREAD_JOB_NAME,
  type ResumeSpreadJobData,
} from "../../../worker/src/jobs/process-resume-spread.js";
import { cancelCampaignJobs } from "../lib/campaign-cancel.js";
import { logger } from "../lib/logger.js";
import type { ApiVariables } from "../types.js";

// ─── Op-id generation ────────────────────────────────────────────────────────
// 12-char alphanumeric (matches packages/shared/src/ids.ts alphabet so all
// op-ids share format with other prefixed ids: lop_api_<12chars>).
const opIdAlphabet = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  LIFECYCLE_OP_ID_LENGTH,
);

/**
 * Resolve the lifecycle_op_id for this request:
 *   - Honor `X-Lifecycle-Op-Id` header when forwarded by upstream MCP/SDK
 *     (per [V2.5] propagation discipline).
 *   - Otherwise generate fresh `lop_api_<12chars>`.
 */
function resolveOpId(headerVal: string | undefined): string {
  const trimmed = headerVal?.trim();
  if (trimmed && trimmed.length >= LIFECYCLE_OP_ID_LENGTH) return trimmed;
  return `lop_api_${opIdAlphabet()}`;
}

// ─── Actor resolution ────────────────────────────────────────────────────────
// Identifies the source of the lifecycle transition for the audit log (CR-11).
// `c.get("userId")` is set by sessionAuth, `c.get("apiKeyId")` by
// workspaceApiKeyAuth. Either may be undefined depending on which auth path
// served the request — the verb endpoints sit under both mount points.

function resolveActor(c: {
  get: (k: string) => unknown;
}): CommitAuditCtx["actor"] {
  const userId = c.get("userId") as string | undefined;
  const apiKeyId = c.get("apiKeyId") as string | undefined;
  if (apiKeyId) return { kind: "agent_key", apiKeyId };
  if (userId) return { kind: "user", userId };
  // Fallback — should not happen in practice because both auth paths set one.
  return { kind: "system" };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchCampaign(workspaceId: string, id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

/** HTTP 409 mapper for IllegalTransitionError. */
function illegalTransition(
  err: IllegalTransitionError,
): {
  error: "INVALID_TRANSITION";
  from: string;
  to: string;
  actual: string | null;
} {
  return {
    error: "INVALID_TRANSITION",
    from: err.expectedFrom,
    to: err.attemptedTo,
    actual: err.actualStatus,
  };
}

// ─── Router ──────────────────────────────────────────────────────────────────

const app = new Hono<{ Variables: ApiVariables }>();

/**
 * POST /:id/pause
 *
 * `active → paused` only. Returns 409 INVALID_TRANSITION on draft / paused /
 * stopping / stopped / archived per [CR-13].
 */
app.post("/:id/pause", async (c) => {
  const start = Date.now();
  const workspaceId = c.get("workspaceId") as string;
  const id = c.req.param("id");
  const lifecycleOpId = resolveOpId(c.req.header("X-Lifecycle-Op-Id"));
  const childLogger = logger.child({ lifecycle_op_id: lifecycleOpId });

  const existing = await fetchCampaign(workspaceId, id);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      await commitLifecycleStatus(tx, "campaigns", id, "active", "paused", {
        lifecycleOpId,
        actor: resolveActor(c),
        workspaceId,
      });
    });
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return c.json(illegalTransition(err), 409);
    }
    throw err;
  }

  // Cancel pending step-execution jobs (Stage 1 helper). Mirrors PATCH-alias
  // behaviour: paused enrollments retain a null completedAt so a future resume
  // can distinguish them.
  await cancelCampaignJobs(id, "paused").catch((err) =>
    childLogger.warn(
      { err: (err as Error).message },
      "cancelCampaignJobs failed during pause",
    ),
  );

  childLogger.info(
    {
      campaignId: id,
      verb: "pause",
      durationMs: Date.now() - start,
    },
    "lifecycle verb committed",
  );

  const updated = await fetchCampaign(workspaceId, id);
  return c.json({ campaign: updated, lifecycle_op_id: lifecycleOpId });
});

/**
 * POST /:id/resume — Stage 3 (T8, REQ-01, CR-01..06, CN-09).
 *
 * `paused → active`. Body extends Stage 2's literal-only validator to
 * support 4 modes:
 *
 *   { mode: "immediate" }
 *   { mode: "spread", spread_window_seconds?, spread_strategy? }
 *   { mode: "skip_stale", stale_threshold_seconds? }
 *   { mode: "skip_stale_spread",
 *     spread_window_seconds?, stale_threshold_seconds?, spread_strategy? }
 *
 * Validation order:
 *   1. Mode enum (Zod) — reject unknown.
 *   2. spread_window_seconds bounds [SPREAD_WINDOW_MIN..MAX] (CN-03 — no
 *      silent fallback; HTTP 400 with reason).
 *   3. Workspace rate-limit config presence — HTTP 503
 *      RATE_LIMIT_CONFIG_MISSING when missing (CN-09).
 *   4. Acquire concurrency lock — HTTP 409 SPREAD_IN_PROGRESS on busy
 *      (CR-03).
 *   5. Commit campaign paused→active (audit chokepoint).
 *   6. For non-immediate: enqueue process-resume-spread worker job.
 *
 * The resume lock is released by:
 *  - the worker on completion (success or error)
 *  - this handler if step 5 fails (cleanup)
 */
const resumeBodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("immediate") }),
  z.object({
    mode: z.literal("spread"),
    spread_window_seconds: z.number().int().positive().optional(),
    spread_strategy: z
      .enum(["fifo_by_original_time", "fifo_by_resume_time"])
      .optional(),
  }),
  z.object({
    mode: z.literal("skip_stale"),
    stale_threshold_seconds: z.number().int().positive().optional(),
  }),
  z.object({
    mode: z.literal("skip_stale_spread"),
    spread_window_seconds: z.number().int().positive().optional(),
    stale_threshold_seconds: z.number().int().positive().optional(),
    spread_strategy: z
      .enum(["fifo_by_original_time", "fifo_by_resume_time"])
      .optional(),
  }),
]);

app.post(
  "/:id/resume",
  zValidator("json", resumeBodySchema.optional()),
  async (c) => {
    const start = Date.now();
    const workspaceId = c.get("workspaceId") as string;
    const id = c.req.param("id");
    const lifecycleOpId = resolveOpId(c.req.header("X-Lifecycle-Op-Id"));
    const childLogger = logger.child({ lifecycle_op_id: lifecycleOpId });
    const body = c.req.valid("json") ?? { mode: "immediate" as const };

    const existing = await fetchCampaign(workspaceId, id);
    if (!existing) return c.json({ error: "Not found" }, 404);

    // Step 2: bounds check (CN-03). Only applies to spread-bearing modes.
    if (body.mode === "spread" || body.mode === "skip_stale_spread") {
      const w = body.spread_window_seconds;
      if (typeof w === "number" &&
          (w < SPREAD_WINDOW_MIN_SECONDS || w > SPREAD_WINDOW_MAX_SECONDS)) {
        return c.json(
          {
            error: "INVALID_SPREAD_WINDOW",
            min_seconds: SPREAD_WINDOW_MIN_SECONDS,
            max_seconds: SPREAD_WINDOW_MAX_SECONDS,
            received: w,
          },
          400,
        );
      }
    }

    // Step 2b — apply workspace defaults for omitted params, then validate
    // bounds on the resolved value too (callers may legitimately leave
    // params off and rely on workspace defaults).
    const db = getDb();
    const [settings] = (await db
      .select()
      .from(workspaceLifecycleSettings)
      .where(eq(workspaceLifecycleSettings.workspaceId, workspaceId))
      .limit(1)) as Array<{
      defaultSpreadWindowSeconds: number;
      defaultStaleThresholdSeconds: number;
      defaultResumeMode: string;
    }>;
    const defaultSpreadWindowSeconds =
      settings?.defaultSpreadWindowSeconds ??
      Number.parseInt(process.env.LIFECYCLE_DEFAULT_SPREAD_WINDOW_SECONDS ?? "14400", 10);
    const defaultStaleThresholdSeconds =
      settings?.defaultStaleThresholdSeconds ??
      Number.parseInt(process.env.LIFECYCLE_DEFAULT_STALE_THRESHOLD_SECONDS ?? "604800", 10);

    let resolvedSpreadWindowSeconds = defaultSpreadWindowSeconds;
    let resolvedStaleThresholdSeconds = defaultStaleThresholdSeconds;
    let resolvedSpreadStrategy: "fifo_by_original_time" | "fifo_by_resume_time" =
      "fifo_by_original_time";

    if (body.mode === "spread" || body.mode === "skip_stale_spread") {
      resolvedSpreadWindowSeconds =
        body.spread_window_seconds ?? defaultSpreadWindowSeconds;
      resolvedSpreadStrategy =
        body.spread_strategy ?? "fifo_by_original_time";
    }
    if (body.mode === "skip_stale" || body.mode === "skip_stale_spread") {
      resolvedStaleThresholdSeconds =
        body.stale_threshold_seconds ?? defaultStaleThresholdSeconds;
    }

    if (body.mode === "spread" || body.mode === "skip_stale_spread") {
      if (
        resolvedSpreadWindowSeconds < SPREAD_WINDOW_MIN_SECONDS ||
        resolvedSpreadWindowSeconds > SPREAD_WINDOW_MAX_SECONDS
      ) {
        return c.json(
          {
            error: "INVALID_SPREAD_WINDOW",
            min_seconds: SPREAD_WINDOW_MIN_SECONDS,
            max_seconds: SPREAD_WINDOW_MAX_SECONDS,
            received: resolvedSpreadWindowSeconds,
          },
          400,
        );
      }
    }

    // Step 3: rate-limit config presence (CN-09). Only relevant for
    // spread-bearing modes — immediate does not consume the spread worker.
    if (body.mode !== "immediate" && body.mode !== "skip_stale") {
      try {
        await readRateLimitConfig(workspaceId);
      } catch (err) {
        if (err instanceof RateLimitConfigMissingError) {
          return c.json(
            {
              error: "RATE_LIMIT_CONFIG_MISSING",
              message:
                "Workspace has no lifecycle rate-limit config. Configure it before resuming with spread mode.",
            },
            503,
          );
        }
        throw err;
      }
    }

    // Step 4: concurrency lock (CR-03). Always acquire — even for immediate
    // mode — to prevent operator double-clicks from causing race conditions.
    const lockTtlMs = Number.parseInt(
      process.env.LIFECYCLE_RESUME_LOCK_TTL_MS ?? "300000",
      10,
    );
    const resumeLockOwner = `${lifecycleOpId}:${Date.now()}`;
    const acquired = await acquireResumeLock(id, lockTtlMs, resumeLockOwner);
    if (!acquired) {
      return c.json(
        {
          error: "SPREAD_IN_PROGRESS",
          message:
            "Another resume operation is already in progress for this campaign. Try again shortly.",
        },
        409,
      );
    }

    let stateCommitted = false;
    try {
      // Step 5: commit campaign paused→active in atomic boundary.
      await db.transaction(async (tx) => {
        await commitLifecycleStatus(tx, "campaigns", id, "paused", "active", {
          lifecycleOpId,
          actor: resolveActor(c),
          workspaceId,
          extraPayload: {
            mode: body.mode,
            spread_window_seconds:
              body.mode === "spread" || body.mode === "skip_stale_spread"
                ? resolvedSpreadWindowSeconds
                : undefined,
            stale_threshold_seconds:
              body.mode === "skip_stale" || body.mode === "skip_stale_spread"
                ? resolvedStaleThresholdSeconds
                : undefined,
            spread_strategy:
              body.mode === "spread" || body.mode === "skip_stale_spread"
                ? resolvedSpreadStrategy
                : undefined,
          },
        });
      });
      stateCommitted = true;

      // Step 6: enqueue process-resume-spread worker for non-immediate modes.
      if (body.mode !== "immediate") {
        const queueData: ResumeSpreadJobData = {
          campaignId: id,
          workspaceId,
          mode: body.mode,
          spreadWindowSeconds: resolvedSpreadWindowSeconds,
          staleThresholdSeconds: resolvedStaleThresholdSeconds,
          spreadStrategy: resolvedSpreadStrategy,
          lifecycleOpId,
          resumeLockOwner,
        };
        await getResumeSpreadQueue().add(RESUME_SPREAD_JOB_NAME, queueData, {
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 50 },
        });
        // Lock is released by the worker on completion. Do NOT release here.
      } else {
        // Immediate mode: release lock immediately.
        await releaseResumeLock(id, resumeLockOwner);
      }
    } catch (err) {
      // Cleanup: release lock if state was not committed (avoid leaking).
      if (!stateCommitted) {
        await releaseResumeLock(id, resumeLockOwner).catch(() => {});
      }
      if (err instanceof IllegalTransitionError) {
        return c.json(illegalTransition(err), 409);
      }
      throw err;
    }

    childLogger.info(
      {
        campaignId: id,
        verb: "resume",
        mode: body.mode,
        spread_window_seconds:
          body.mode === "spread" || body.mode === "skip_stale_spread"
            ? resolvedSpreadWindowSeconds
            : undefined,
        stale_threshold_seconds:
          body.mode === "skip_stale" || body.mode === "skip_stale_spread"
            ? resolvedStaleThresholdSeconds
            : undefined,
        durationMs: Date.now() - start,
      },
      "lifecycle verb committed",
    );

    const updated = await fetchCampaign(workspaceId, id);
    return c.json({
      campaign: updated,
      lifecycle_op_id: lifecycleOpId,
      mode: body.mode,
      spread_window_seconds:
        body.mode === "spread" || body.mode === "skip_stale_spread"
          ? resolvedSpreadWindowSeconds
          : undefined,
      stale_threshold_seconds:
        body.mode === "skip_stale" || body.mode === "skip_stale_spread"
          ? resolvedStaleThresholdSeconds
          : undefined,
    });
  },
);

/**
 * POST /:id/stop
 *
 * Discriminated union body:
 *   { mode: "drain" }                                → active|paused → stopping
 *   { mode: "force", confirm_force: true }           → active|paused → stopped
 *
 * `confirm_force: true` literal REQUIRED for force mode (CR-10 — prevent
 * accidental cancellation of in-flight emails).
 */
const stopBodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("drain") }),
  z.object({ mode: z.literal("force"), confirm_force: z.literal(true) }),
]);

app.post("/:id/stop", zValidator("json", stopBodySchema), async (c) => {
  const start = Date.now();
  const workspaceId = c.get("workspaceId") as string;
  const id = c.req.param("id");
  const lifecycleOpId = resolveOpId(c.req.header("X-Lifecycle-Op-Id"));
  const childLogger = logger.child({ lifecycle_op_id: lifecycleOpId });
  const body = c.req.valid("json");

  const existing = await fetchCampaign(workspaceId, id);
  if (!existing) return c.json({ error: "Not found" }, 404);
  // For drain/force we must source from active OR paused; the underlying helper
  // only checks ONE `from` so we read first and pass the actual current status.
  const from = existing.status;
  if (from !== "active" && from !== "paused") {
    return c.json(
      { error: "INVALID_TRANSITION", from, to: body.mode === "drain" ? "stopping" : "stopped", actual: from },
      409,
    );
  }

  const db = getDb();

  if (body.mode === "drain") {
    try {
      await db.transaction(async (tx) => {
        await commitLifecycleStatus(tx, "campaigns", id, from, "stopping", {
          lifecycleOpId,
          actor: resolveActor(c),
          workspaceId,
          // `defaultEventTypeFor` maps "stopping" → "stop_drain_started"
          extraPayload: { mode: "drain" },
        });
      });
    } catch (err) {
      if (err instanceof IllegalTransitionError) {
        return c.json(illegalTransition(err), 409);
      }
      throw err;
    }

    childLogger.info(
      {
        campaignId: id,
        verb: "stop",
        mode: "drain",
        durationMs: Date.now() - start,
      },
      "lifecycle verb committed",
    );

    const updated = await fetchCampaign(workspaceId, id);
    return c.json({ campaign: updated, lifecycle_op_id: lifecycleOpId });
  }

  // mode === "force" — terminal stop. Cancel BullMQ jobs FIRST (Stage 1 helper,
  // exact-jobId, idempotent), then commit the campaign status flip + emit
  // per-enrollment force_exited audit events for any enrollments that were
  // active at cancel time.
  const actor = resolveActor(c);
  let cancelled = 0;
  try {
    // Read active enrollments BEFORE cancellation so we can audit each one.
    // This is racy (an enrollment could go inactive between read and audit),
    // but the campaign-cancel helper itself is idempotent and only flips rows
    // still 'active' at cancel time, so any enrollment audited here was
    // genuinely active when this request arrived.
    const activeEnrollments = await db
      .select({
        id: campaignEnrollments.id,
        contactId: campaignEnrollments.contactId,
      })
      .from(campaignEnrollments)
      .where(
        and(
          eq(campaignEnrollments.campaignId, id),
          eq(campaignEnrollments.status, "active"),
        ),
      );

    const cancelResult = await cancelCampaignJobs(id, "cancelled");
    cancelled = cancelResult.cancelled;

    // Emit per-enrollment force_exited events + commit campaign → stopped in
    // one transaction (CR-01 — same atomic boundary as the campaign mutation).
    await db.transaction(async (tx) => {
      // Per-enrollment force_exited events (aggregate-level after the loop).
      for (const enr of activeEnrollments) {
        await audit.emit(
          enr.id,
          "force_exited",
          {
            campaignId: id,
            workspaceId,
            contactId: enr.contactId,
            actor,
            payload: {
              lifecycle_op_id: lifecycleOpId,
              reason: "stop_force_by_operator",
            },
            before: { status: "active" },
            after: { status: "cancelled" },
          },
          tx,
        );
      }

      // Commit campaigns → stopped (emits "drain_completed" via default
      // mapping; we override to "force_exited" to record explicit stop-force).
      await commitLifecycleStatus(tx, "campaigns", id, from, "stopped", {
        lifecycleOpId,
        actor,
        workspaceId,
        eventTypeOverride: "force_exited",
        extraPayload: {
          mode: "force",
          cancelled_enrollments: cancelled,
        },
      });
    });
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return c.json(illegalTransition(err), 409);
    }
    throw err;
  }

  childLogger.info(
    {
      campaignId: id,
      verb: "stop",
      mode: "force",
      cancelled,
      durationMs: Date.now() - start,
    },
    "lifecycle verb committed",
  );

  const updated = await fetchCampaign(workspaceId, id);
  return c.json({ campaign: updated, lifecycle_op_id: lifecycleOpId, cancelled });
});

/**
 * POST /:id/archive
 *
 * `* → archived`. Idempotent on already-archived (returns 200) per [CR-13].
 * Body MUST contain `confirm_terminal: true` literal — Zod hard requirement
 * (CR-10).
 */
app.post(
  "/:id/archive",
  zValidator("json", z.object({ confirm_terminal: z.literal(true) })),
  async (c) => {
    const start = Date.now();
    const workspaceId = c.get("workspaceId") as string;
    const id = c.req.param("id");
    const lifecycleOpId = resolveOpId(c.req.header("X-Lifecycle-Op-Id"));
    const childLogger = logger.child({ lifecycle_op_id: lifecycleOpId });

    const existing = await fetchCampaign(workspaceId, id);
    if (!existing) return c.json({ error: "Not found" }, 404);

    // Idempotent: already-archived returns 200 without state change or audit
    // emission [CR-13]. Audit log already records the original archive event.
    if (existing.status === "archived") {
      childLogger.info(
        { campaignId: id, verb: "archive", idempotent: true, durationMs: Date.now() - start },
        "lifecycle verb idempotent (already archived)",
      );
      return c.json({ campaign: existing, lifecycle_op_id: lifecycleOpId, idempotent: true });
    }

    const from = existing.status;
    const db = getDb();
    try {
      await db.transaction(async (tx) => {
        await commitLifecycleStatus(tx, "campaigns", id, from, "archived", {
          lifecycleOpId,
          actor: resolveActor(c),
          workspaceId,
        });
      });
    } catch (err) {
      if (err instanceof IllegalTransitionError) {
        return c.json(illegalTransition(err), 409);
      }
      throw err;
    }

    // Cancel pending enrollment jobs after the status flip (mirrors PATCH alias
    // legacy behaviour for archived campaigns).
    await cancelCampaignJobs(id, "cancelled").catch((err) =>
      childLogger.warn(
        { err: (err as Error).message },
        "cancelCampaignJobs failed during archive",
      ),
    );

    childLogger.info(
      { campaignId: id, verb: "archive", from, durationMs: Date.now() - start },
      "lifecycle verb committed",
    );

    const updated = await fetchCampaign(workspaceId, id);
    return c.json({ campaign: updated, lifecycle_op_id: lifecycleOpId });
  },
);

export default app;
