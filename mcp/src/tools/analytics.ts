import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { getApiClient } from "../lib/api-client.js";

export function registerAnalyticsTools(server: McpServer, getClient: () => ReturnType<typeof getApiClient>) {
  server.tool(
    "get_analytics",
    "Get workspace analytics overview for the last 30 days: contacts, sends, open rate, click rate, unsubscribes.",
    {},
    async () => {
      const data = await getClient().get("/analytics/overview");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_broadcast_analytics",
    "Get detailed analytics for a specific broadcast.",
    {
      broadcastId: z.string().describe("Broadcast ID (brd_xxx)"),
    },
    async ({ broadcastId }) => {
      const data = await getClient().get(`/analytics/broadcasts/${broadcastId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
