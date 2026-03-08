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
      name: z.string(),
      triggerType: z.enum(["event", "segment_enter", "segment_exit", "manual"]),
      triggerConfig: z.record(z.unknown()).optional().describe("e.g. { eventName: 'user_signed_up' }"),
      description: z.string().optional(),
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
      campaignId: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["draft", "active", "paused", "archived"]).optional(),
    },
    async ({ campaignId, ...body }) => {
      const data = await getClient().patch(`/campaigns/${campaignId}`, body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "pause_campaign",
    "Pause an active campaign.",
    { campaignId: z.string() },
    async ({ campaignId }) => {
      const data = await getClient().patch(`/campaigns/${campaignId}`, { status: "paused" });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
