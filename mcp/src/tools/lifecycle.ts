/**
 * MCP lifecycle tools (Stage 2 — T15, REQ-17, [A2.11], [CR-10], [CR-15]).
 *
 * 3 tools that wrap the new POST /api/v1/campaigns/:id/{verb} endpoints:
 *   - resume_campaign  (paused → active)
 *   - stop_campaign    (drain or force)
 *   - archive_campaign (terminal, requires confirm_terminal)
 *
 * `pause_campaign` is intentionally NOT registered here — the existing
 * `pause_campaign` in `tools/campaigns.ts` is kept (per CN-06 — backward
 * compat). MCP SDK requires unique tool names; registering the same name
 * twice causes the second to overwrite the first silently. The legacy
 * pause_campaign now drives the deprecated PATCH-status alias which, after
 * R5, routes through `commitLifecycleStatus` for full audit trail — so AI
 * agents calling either endpoint produce identical audit-trail results.
 *
 * Each tool:
 *   1. Generates a `lifecycle_op_id` (12-char nanoid prefixed `lop_mcp_`) at
 *      the tool boundary so AI-agent operations correlate end-to-end through
 *      the audit log (CR-15).
 *   2. Forwards the op-id as `X-Lifecycle-Op-Id` request header — the API
 *      verb handler reads it instead of generating a fresh one ([V2.5]).
 *   3. Uses Zod literal requirements (`confirm_terminal: z.literal(true)`,
 *      `confirm_force: z.literal(true)`) so the LLM cannot accidentally
 *      invoke destructive actions without explicit acknowledgment (CR-10).
 */

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LIFECYCLE_OP_ID_LENGTH } from "@openmail/shared";
import type { getApiClient } from "../lib/api-client.js";

// 12-char nanoid matching packages/shared/src/ids.ts alphabet so all op-ids
// share format across services. Lazy-init: factory called once per process.
const opIdAlphabet = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  LIFECYCLE_OP_ID_LENGTH,
);

function newOpId(): string {
  return `lop_mcp_${opIdAlphabet()}`;
}

function opIdHeader(): Record<string, string> {
  return { "X-Lifecycle-Op-Id": newOpId() };
}

export function registerLifecycleTools(
  server: McpServer,
  getClient: () => ReturnType<typeof getApiClient>,
) {
  // pause_campaign is intentionally NOT registered here — see file header.
  // The legacy `pause_campaign` in tools/campaigns.ts is the only registration
  // (it now routes through the audited PATCH alias post-R5).

  // ── resume_campaign ────────────────────────────────────────────────────────
  // Stage 3 extends to 4 modes: immediate / spread / skip_stale / skip_stale_spread.
  // Per CR-08 description STRONGLY recommends spread for >24h pauses.
  server.tool(
    "resume_campaign",
    "Resume a paused campaign. Four modes: " +
      "(1) 'immediate' — send all overdue messages at once (DANGEROUS for long pauses; can spike to thousands of sends/min). " +
      "(2) 'spread' — distribute overdue sends across a time window (RECOMMENDED if pause was >24h). " +
      "(3) 'skip_stale' — drop overdue sends older than the threshold and advance enrollments. " +
      "(4) 'skip_stale_spread' — drop stale, then spread the remainder (best of both worlds). " +
      "⚠️ For pauses longer than 24 hours, use 'spread' or 'skip_stale_spread' to avoid recipient inbox spam and Resend rate-limit hits. " +
      "Industry context: NO competitor (Customer.io, Mailchimp, ActiveCampaign, HubSpot, Mautic) implements burst mitigation — OpenMail is the only platform that does this safely.",
    {
      campaignId: z.string().describe("Campaign ID (cmp_xxx)"),
      mode: z
        .enum([
          "immediate",
          "spread",
          "skip_stale",
          "skip_stale_spread",
        ])
        .optional()
        .describe(
          "Resume mode. Default: 'immediate'. Use 'spread' or 'skip_stale_spread' for pauses longer than 24 hours.",
        ),
      spread_window_seconds: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Spread window in seconds (used with 'spread' or 'skip_stale_spread'). Default = workspace setting (typically 14400 = 4h). Min 60, max 2592000 (30d).",
        ),
      stale_threshold_seconds: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Stale threshold in seconds (used with 'skip_stale' or 'skip_stale_spread'). Sends scheduled longer ago than this are dropped. Default = workspace setting (typically 604800 = 7d).",
        ),
      spread_strategy: z
        .enum(["fifo_by_original_time", "fifo_by_resume_time"])
        .optional()
        .describe(
          "Sort order for spread schedule. 'fifo_by_original_time' (default) = oldest scheduled-at first; 'fifo_by_resume_time' = preserve insertion order.",
        ),
    },
    async ({
      campaignId,
      mode,
      spread_window_seconds,
      stale_threshold_seconds,
      spread_strategy,
    }) => {
      // Build the request body per discriminated union expected by the API.
      const resolvedMode = mode ?? "immediate";
      const body: Record<string, unknown> = { mode: resolvedMode };
      if (resolvedMode === "spread" || resolvedMode === "skip_stale_spread") {
        if (spread_window_seconds !== undefined)
          body.spread_window_seconds = spread_window_seconds;
        if (spread_strategy !== undefined)
          body.spread_strategy = spread_strategy;
      }
      if (resolvedMode === "skip_stale" || resolvedMode === "skip_stale_spread") {
        if (stale_threshold_seconds !== undefined)
          body.stale_threshold_seconds = stale_threshold_seconds;
      }

      const data = await getClient().post(
        `/campaigns/${campaignId}/resume`,
        body,
        opIdHeader(),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // ── stop_campaign ──────────────────────────────────────────────────────────
  // Discriminated union: force mode REQUIRES confirm_force: true.
  const stopArgs = {
    campaignId: z.string().describe("Campaign ID (cmp_xxx)"),
    mode: z
      .enum(["drain", "force"])
      .describe(
        "drain (recommended): wait for in-flight enrollments to finish naturally before final stop. " +
          "force: ⚠️ DESTRUCTIVE — cancels all pending wait jobs immediately and force-exits in-flight enrollments. " +
          "Use 'drain' unless you absolutely need an immediate halt.",
      ),
    confirm_force: z
      .literal(true)
      .optional()
      .describe(
        "REQUIRED when mode='force'. Pass `true` to acknowledge that in-flight emails will be cancelled.",
      ),
  };

  server.tool(
    "stop_campaign",
    "Stop a campaign — drain mode is reversible-until-stopped (sweeper completes drain when in-flight enrollments finish). " +
      "Force mode ⚠️ IMMEDIATELY CANCELS all pending wait jobs and force-exits in-flight enrollments. " +
      "Force mode REQUIRES confirm_force: true. " +
      "Drain is the default operator-friendly choice; force is for emergencies.",
    stopArgs,
    async ({ campaignId, mode, confirm_force }) => {
      // Server-side confirmation: even if Zod allowed missing literal, reject
      // here so a typo can't trigger force without explicit consent.
      if (mode === "force" && confirm_force !== true) {
        throw new Error(
          "stop_campaign: mode='force' requires confirm_force: true. " +
            "Pass confirm_force: true to acknowledge that in-flight emails will be cancelled.",
        );
      }
      const body =
        mode === "force"
          ? { mode: "force" as const, confirm_force: true as const }
          : { mode: "drain" as const };
      const data = await getClient().post(
        `/campaigns/${campaignId}/stop`,
        body,
        opIdHeader(),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // ── pause_campaign_step (Stage 4) ──────────────────────────────────────────
  // Per-step pause halts new arrivals at THIS step but does NOT affect
  // enrollments at other steps. Held enrollments remain in place until
  // resume_campaign_step is called or the step is deleted.
  server.tool(
    "pause_campaign_step",
    "Pause a SINGLE step in a campaign (Stage 4 — granular per-step pause). " +
      "Enrollments waiting at this step are 'held' until resume. Enrollments at OTHER steps continue normally. " +
      "This is the only platform that supports granular per-step pause — Customer.io / Mailchimp pause the whole campaign. " +
      "Useful for: editing a step's email template safely without halting the whole campaign, debugging a single step, A/B-test rollback.",
    {
      campaignId: z.string().describe("Campaign ID (cmp_xxx)"),
      stepId: z.string().describe("Step ID (stp_xxx) within the campaign"),
    },
    async ({ campaignId, stepId }) => {
      const data = await getClient().post(
        `/campaigns/${campaignId}/steps/${stepId}/pause`,
        {},
        opIdHeader(),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // ── resume_campaign_step (Stage 4) ─────────────────────────────────────────
  // Per-step resume mirrors campaign-level resume modes (Stage 3) but scoped
  // to enrollments held at the named step.
  server.tool(
    "resume_campaign_step",
    "Resume a paused step (Stage 4). Same 4 modes as resume_campaign but scoped to one step's held enrollments. " +
      "If the step was paused for >24h with many held enrollments, prefer 'spread' or 'skip_stale_spread' to avoid burst-send.",
    {
      campaignId: z.string().describe("Campaign ID (cmp_xxx)"),
      stepId: z.string().describe("Step ID (stp_xxx) within the campaign"),
      mode: z
        .enum(["immediate", "spread", "skip_stale", "skip_stale_spread"])
        .optional()
        .describe(
          "Resume mode. Default: 'immediate'. Use 'spread' or 'skip_stale_spread' for long pauses.",
        ),
      spread_window_seconds: z.number().int().positive().optional(),
      stale_threshold_seconds: z.number().int().positive().optional(),
      spread_strategy: z
        .enum(["fifo_by_original_time", "fifo_by_resume_time"])
        .optional(),
    },
    async ({
      campaignId,
      stepId,
      mode,
      spread_window_seconds,
      stale_threshold_seconds,
      spread_strategy,
    }) => {
      const resolvedMode = mode ?? "immediate";
      const body: Record<string, unknown> = { mode: resolvedMode };
      if (resolvedMode === "spread" || resolvedMode === "skip_stale_spread") {
        if (spread_window_seconds !== undefined)
          body.spread_window_seconds = spread_window_seconds;
        if (spread_strategy !== undefined) body.spread_strategy = spread_strategy;
      }
      if (
        resolvedMode === "skip_stale" ||
        resolvedMode === "skip_stale_spread"
      ) {
        if (stale_threshold_seconds !== undefined)
          body.stale_threshold_seconds = stale_threshold_seconds;
      }
      const data = await getClient().post(
        `/campaigns/${campaignId}/steps/${stepId}/resume`,
        body,
        opIdHeader(),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // ── get_enrollment_timeline (Stage 6) ────────────────────────────────────
  server.tool(
    "get_enrollment_timeline",
    "Fetch the chronological event history for a single enrollment. Returns " +
      "paginated events ordered by event_seq DESC (most recent first). Use this " +
      "to debug why a contact ended up in a particular state, replay how the " +
      "engine handled them, or surface a customer-support timeline. " +
      "Set include_archive=true to also walk the archive table for events " +
      "older than the audit retention window (default 180 days).",
    {
      campaignId: z.string().describe("Campaign ID (cmp_xxx)"),
      enrollmentId: z.string().describe("Enrollment ID (eee_xxx)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Page size, 1..200, default 50"),
      before: z
        .string()
        .optional()
        .describe(
          "ISO timestamp cursor — returns events with emitted_at strictly less than this",
        ),
      eventTypes: z
        .array(z.string())
        .optional()
        .describe(
          "Filter to these event types (e.g. ['paused','resumed','step_advanced'])",
        ),
      includeArchive: z
        .boolean()
        .optional()
        .describe(
          "Walk enrollment_events_archive in addition to the live table (slower)",
        ),
    },
    async ({
      campaignId,
      enrollmentId,
      limit,
      before,
      eventTypes,
      includeArchive,
    }) => {
      const params: Record<string, string> = {};
      if (limit !== undefined) params.limit = String(limit);
      if (before) params.before = before;
      if (eventTypes && eventTypes.length > 0)
        params.event_types = eventTypes.join(",");
      if (includeArchive) params.include_archive = "true";
      const qs = new URLSearchParams(params).toString();
      const path = `/campaigns/${campaignId}/enrollments/${enrollmentId}/events${qs ? `?${qs}` : ""}`;
      const data = await getClient().get(path, opIdHeader());
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // ── archive_campaign ───────────────────────────────────────────────────────
  server.tool(
    "archive_campaign",
    "⚠️ TERMINAL — archive a campaign. Archived campaigns CANNOT be reactivated. " +
      "Used to retire campaigns from the active list while preserving the audit trail and historical analytics. " +
      "Pass confirm_terminal: true to acknowledge this is intentional and irreversible.",
    {
      campaignId: z.string().describe("Campaign ID (cmp_xxx)"),
      confirm_terminal: z
        .literal(true)
        .describe(
          "REQUIRED. Pass `true` to acknowledge that archive is terminal and cannot be undone.",
        ),
    },
    async ({ campaignId, confirm_terminal }) => {
      // Defensive: Zod literal already enforces, but keep redundancy for AI safety (CR-10).
      if (confirm_terminal !== true) {
        throw new Error(
          "archive_campaign: confirm_terminal: true is REQUIRED. Archive is permanent and cannot be undone.",
        );
      }
      const data = await getClient().post(
        `/campaigns/${campaignId}/archive`,
        { confirm_terminal: true },
        opIdHeader(),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );
}
