import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { getApiClient } from "../lib/api-client.js";

export function registerCampaignTools(server: McpServer, getClient: () => ReturnType<typeof getApiClient>) {
  server.tool(
    "list_campaigns",
    "[Stable] List all automation campaigns.",
    {},
    async () => {
      const data = await getClient().get("/campaigns");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "create_campaign",
    "[Stable] Create an automation campaign triggered by an event or segment.",
    {
      name:          z.string().describe("Campaign name shown in the dashboard"),
      triggerType:   z.enum(["event", "segment_enter", "segment_exit", "manual"]).describe(
        "What triggers this campaign: 'event' (a tracked customer action), 'segment_enter' (contact joins a segment), 'segment_exit' (contact leaves a segment), 'manual' (triggered via API)"
      ),
      triggerConfig: z.record(z.unknown()).optional().describe("Trigger configuration. For 'event' trigger: { eventName: 'user_signed_up' }. For segment triggers: { segmentId: 'seg_xxx' }"),
      description:   z.string().optional().describe("Optional campaign description"),
    },
    async (body) => {
      const data = await getClient().post("/campaigns", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "update_campaign",
    "[Beta] Update a campaign's name, description, or status. " +
      "⚠️ Setting `status` here is DEPRECATED — use the lifecycle.* tools (pause_campaign, resume_campaign, stop_campaign, archive_campaign) for richer behavior with full audit trail. " +
      "Marked Beta because the status-mutation surface is still functional but slated for removal once SDK consumers migrate to the verb endpoints.",
    {
      campaignId:  z.string().describe("Campaign ID (cmp_xxx)"),
      name:        z.string().optional().describe("New campaign name"),
      description: z.string().optional().describe("New campaign description"),
      status:      z.enum(["draft", "active", "paused", "archived"]).optional().describe(
        "[DEPRECATED — use lifecycle.* tools] Set to 'active' to start sending, 'paused' to stop without archiving, 'archived' to retire the campaign"
      ),
    },
    async ({ campaignId, ...body }) => {
      const data = await getClient().patch(`/campaigns/${campaignId}`, body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "pause_campaign",
    "[Stable] Pause an active campaign. Contacts already in the campaign will not receive further emails until it is reactivated. " +
      "Drives the PATCH-status alias which (post Stage 2 Round 5) routes through the audit chokepoint, " +
      "so the audit trail is identical to the lifecycle verb endpoints. " +
      "Use `resume_campaign` (immediate mode) to reactivate, `stop_campaign` to drain/force-stop, " +
      "or `archive_campaign` to retire permanently.",
    { campaignId: z.string().describe("Campaign ID (cmp_xxx)") },
    async ({ campaignId }) => {
      const data = await getClient().patch(`/campaigns/${campaignId}`, { status: "paused" });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
