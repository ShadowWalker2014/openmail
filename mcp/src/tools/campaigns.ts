import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { getApiClient } from "../lib/api-client.js";

export function registerCampaignTools(server: McpServer, getClient: () => ReturnType<typeof getApiClient>) {
  server.tool(
    "list_campaigns",
    "List all automation campaigns.",
    {},
    async () => {
      const data = await getClient().get("/campaigns");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "create_campaign",
    "Create an automation campaign triggered by an event or segment.",
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
    "Update a campaign's name, description, or status.",
    {
      campaignId:  z.string().describe("Campaign ID (cmp_xxx)"),
      name:        z.string().optional().describe("New campaign name"),
      description: z.string().optional().describe("New campaign description"),
      status:      z.enum(["draft", "active", "paused", "archived"]).optional().describe(
        "Set to 'active' to start sending, 'paused' to stop without archiving, 'archived' to retire the campaign"
      ),
    },
    async ({ campaignId, ...body }) => {
      const data = await getClient().patch(`/campaigns/${campaignId}`, body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "pause_campaign",
    "Pause an active campaign. Contacts already in the campaign will not receive further emails until it is reactivated.",
    { campaignId: z.string().describe("Campaign ID (cmp_xxx)") },
    async ({ campaignId }) => {
      const data = await getClient().patch(`/campaigns/${campaignId}`, { status: "paused" });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
