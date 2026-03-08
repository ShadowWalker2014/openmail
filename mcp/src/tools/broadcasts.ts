import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { getApiClient } from "../lib/api-client.js";

export function registerBroadcastTools(server: McpServer, getClient: () => ReturnType<typeof getApiClient>) {
  server.tool(
    "list_broadcasts",
    "List all broadcasts in the workspace.",
    {},
    async () => {
      const data = await getClient().get("/broadcasts");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "create_broadcast",
    "Create a new broadcast email campaign.",
    {
      name: z.string().describe("Internal name for this broadcast"),
      subject: z.string().describe("Email subject line"),
      htmlContent: z.string().optional().describe("HTML email content"),
      templateId: z.string().optional().describe("Use a saved template ID instead"),
      segmentIds: z.array(z.string()).describe("Segment IDs to send to"),
      scheduledAt: z.string().optional().describe("ISO 8601 datetime to schedule send"),
    },
    async (body) => {
      const data = await getClient().post("/broadcasts", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "schedule_broadcast",
    "Schedule a broadcast to be sent at a future date/time.",
    {
      broadcastId: z.string().describe("Broadcast ID (brd_xxx)"),
      scheduledAt: z.string().datetime().describe("ISO 8601 datetime for when to send (e.g. 2024-12-25T09:00:00Z)"),
    },
    async ({ broadcastId, scheduledAt }) => {
      const data = await getClient().patch(`/broadcasts/${broadcastId}`, { scheduledAt });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "send_broadcast",
    "Immediately send a broadcast (must be in draft status).",
    { broadcastId: z.string().describe("Broadcast ID (brd_xxx)") },
    async ({ broadcastId }) => {
      const data = await getClient().post(`/broadcasts/${broadcastId}/send`, {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
