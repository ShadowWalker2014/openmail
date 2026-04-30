/**
 * MCP campaign-goals tools (Stage 5 — T10, REQ-04).
 *
 * Four tools that wrap the `/campaigns/:id/goals` API:
 *   - add_campaign_goal
 *   - list_campaign_goals
 *   - update_campaign_goal
 *   - remove_campaign_goal
 *
 * Tool descriptions emphasise common patterns ("exit on conversion event",
 * "exit when segment membership changes") so AI agents pick the right
 * condition_type without trial-and-error.
 *
 * Each mutation tool generates a `lifecycle_op_id` (`lop_mcp_goal_*`) and
 * forwards it via the `X-Lifecycle-Op-Id` header so audit events correlate
 * back to the originating MCP call.
 *
 * Condition shape mirrors the API's Zod discriminated union (Task 9):
 *   - { type: "event", eventName, propertyFilter?, sinceEnrollment? }
 *   - { type: "attribute", attributeKey, operator, value? }
 *   - { type: "segment", segmentId, requireMembership? }
 */
import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LIFECYCLE_OP_ID_LENGTH } from "@openmail/shared";
import type { getApiClient } from "../lib/api-client.js";

const opIdAlphabet = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  LIFECYCLE_OP_ID_LENGTH,
);
const newOpId = () => `lop_mcp_goal_${opIdAlphabet()}`;
const opIdHeader = () => ({ "X-Lifecycle-Op-Id": newOpId() });

// Re-declare the Zod condition union so MCP gets full schema introspection
// (mirroring api/src/routes/campaign-goals.ts).
const eventCondition = z.object({
  type: z.literal("event"),
  eventName: z.string().min(1).describe("Name of the tracked event"),
  propertyFilter: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional event property equality filter"),
  sinceEnrollment: z
    .boolean()
    .optional()
    .describe(
      "When true (default), only events occurring after enrollment.startedAt count. Set false to count pre-enrollment events too (rarely correct).",
    ),
});

const attributeCondition = z.object({
  type: z.literal("attribute"),
  attributeKey: z.string().min(1),
  operator: z.enum(["eq", "neq", "gt", "lt", "contains", "exists"]),
  value: z.unknown().optional(),
});

const segmentCondition = z.object({
  type: z.literal("segment"),
  segmentId: z.string().min(1).describe("Segment ID (seg_xxx)"),
  requireMembership: z
    .boolean()
    .optional()
    .describe(
      "When true (default), goal fires when contact JOINS segment. When false, fires when contact LEAVES segment.",
    ),
});

const conditionSchema = z.discriminatedUnion("type", [
  eventCondition,
  attributeCondition,
  segmentCondition,
]);

export function registerGoalTools(
  server: McpServer,
  getClient: () => ReturnType<typeof getApiClient>,
) {
  // ── add_campaign_goal ──────────────────────────────────────────────────────
  server.tool(
    "add_campaign_goal",
    "Add a goal to a campaign. When the contact's state matches the goal, the enrollment exits early via `goal_achieved` (no further steps fire). " +
      "Common patterns: " +
      "(1) Exit on conversion event — `condition: {type: 'event', eventName: 'checkout_completed'}` ends a checkout-recovery flow once the user pays. " +
      "(2) Exit when segment membership changes — `condition: {type: 'segment', segmentId: 'seg_inactive', requireMembership: false}` ends a re-engagement flow when the contact leaves the inactive segment. " +
      "(3) Exit on attribute change — `condition: {type: 'attribute', attributeKey: 'plan', operator: 'eq', value: 'pro'}` ends a free-tier upsell flow when the user upgrades. " +
      "Multiple goals on a campaign are evaluated with OR semantics.",
    {
      campaignId: z.string().describe("Campaign ID (cmp_xxx)"),
      condition: conditionSchema,
      position: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Display order (0-based). OR semantics — does NOT short-circuit."),
      enabled: z
        .boolean()
        .optional()
        .describe("Defaults to true. Disabled goals are skipped during evaluation."),
    },
    async ({ campaignId, condition, position, enabled }) => {
      const data = await getClient().post(
        `/campaigns/${campaignId}/goals`,
        { condition, position, enabled },
        opIdHeader(),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // ── list_campaign_goals ────────────────────────────────────────────────────
  server.tool(
    "list_campaign_goals",
    "List all goals on a campaign, ordered by `position`. Returns enabled and disabled goals.",
    {
      campaignId: z.string().describe("Campaign ID (cmp_xxx)"),
    },
    async ({ campaignId }) => {
      const data = await getClient().get(`/campaigns/${campaignId}/goals`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // ── update_campaign_goal ───────────────────────────────────────────────────
  server.tool(
    "update_campaign_goal",
    "Partially update a goal. Pass only the fields you want changed. " +
      "Editing is allowed on draft / active / paused campaigns; HTTP 409 on stopping / stopped / archived.",
    {
      campaignId: z.string().describe("Campaign ID (cmp_xxx)"),
      goalId: z.string().describe("Goal ID (gol_xxx)"),
      condition: conditionSchema.optional(),
      position: z.number().int().min(0).optional(),
      enabled: z.boolean().optional(),
    },
    async ({ campaignId, goalId, condition, position, enabled }) => {
      const body: Record<string, unknown> = {};
      if (condition !== undefined) body.condition = condition;
      if (position !== undefined) body.position = position;
      if (enabled !== undefined) body.enabled = enabled;
      const data = await getClient().patch(
        `/campaigns/${campaignId}/goals/${goalId}`,
        body,
        opIdHeader(),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // ── remove_campaign_goal ───────────────────────────────────────────────────
  server.tool(
    "remove_campaign_goal",
    "Hard-delete a goal. Existing enrollments already completed via this goal retain their `completed_via_goal_id` reference (audit-only — the goal id is no longer joinable but the audit log preserves the match payload).",
    {
      campaignId: z.string().describe("Campaign ID (cmp_xxx)"),
      goalId: z.string().describe("Goal ID (gol_xxx)"),
    },
    async ({ campaignId, goalId }) => {
      const data = await getClient().delete(
        `/campaigns/${campaignId}/goals/${goalId}`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );
}
