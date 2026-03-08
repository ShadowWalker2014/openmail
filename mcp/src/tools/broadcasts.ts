import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { getApiClient } from "../lib/api-client.js";

export function registerBroadcastTools(server: McpServer, getClient: () => ReturnType<typeof getApiClient>) {
  server.tool(
    "list_broadcasts",
    "List all broadcasts in the workspace including their status (draft, sending, sent, failed).",
    {},
    async () => {
      const data = await getClient().get("/broadcasts");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_broadcast",
    "Get a single broadcast by ID, including its current status, subject, content, and recipient count.",
    { broadcastId: z.string().describe("Broadcast ID (brd_xxx)") },
    async ({ broadcastId }) => {
      const data = await getClient().get(`/broadcasts/${broadcastId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "create_broadcast",
    `Create a new broadcast email campaign (starts in draft status — call send_broadcast when ready).
To embed images, first use upload_asset_from_url to get a proxyUrl, then use it in htmlContent:
  <img src="{proxyUrl}" alt="description" style="max-width:100%;display:block">
Either provide htmlContent directly or reference a saved templateId (not both).`,
    {
      name:        z.string().describe("Internal name for this broadcast (not shown to recipients)"),
      subject:     z.string().describe("Email subject line shown in the recipient's inbox"),
      htmlContent: z.string().optional().describe("Full HTML email body. Use asset proxyUrls for images. Either this or templateId is required."),
      templateId:  z.string().optional().describe("Use a saved template ID (tpl_xxx) instead of inline htmlContent"),
      segmentIds:  z.array(z.string()).describe("One or more segment IDs (seg_xxx) to send to. Use list_segments to find IDs."),
      fromEmail:   z.string().email().optional().describe("Sender email address (e.g. hello@company.com). Falls back to workspace default."),
      fromName:    z.string().optional().describe("Sender display name (e.g. 'Acme Team'). Falls back to workspace default."),
      scheduledAt: z.string().optional().describe("ISO 8601 datetime to schedule (omit to keep as draft and call send_broadcast manually)"),
    },
    async (body) => {
      const data = await getClient().post("/broadcasts", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "update_broadcast",
    "Update a broadcast that is still in draft status. Cannot update a broadcast that is sending or has already sent.",
    {
      broadcastId: z.string().describe("Broadcast ID (brd_xxx)"),
      name:        z.string().optional().describe("New internal name"),
      subject:     z.string().optional().describe("New email subject line"),
      htmlContent: z.string().optional().describe("New HTML email body"),
      templateId:  z.string().optional().describe("Switch to a different template (tpl_xxx)"),
      fromEmail:   z.string().email().optional().describe("New sender email address"),
      fromName:    z.string().optional().describe("New sender display name"),
      segmentIds:  z.array(z.string()).optional().describe("Replace the target segments"),
      scheduledAt: z.string().optional().describe("Update or set scheduled send time (ISO 8601)"),
    },
    async ({ broadcastId, ...body }) => {
      const data = await getClient().patch(`/broadcasts/${broadcastId}`, body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "schedule_broadcast",
    "Schedule a draft broadcast to send at a specific future date/time.",
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
    "Immediately send a broadcast. The broadcast must be in draft status. This action is irreversible once started.",
    { broadcastId: z.string().describe("Broadcast ID (brd_xxx)") },
    async ({ broadcastId }) => {
      const data = await getClient().post(`/broadcasts/${broadcastId}/send`, {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "delete_broadcast",
    "Delete a broadcast. Only draft and scheduled broadcasts can be deleted — a broadcast that is actively sending cannot be deleted.",
    { broadcastId: z.string().describe("Broadcast ID (brd_xxx)") },
    async ({ broadcastId }) => {
      const data = await getClient().delete(`/broadcasts/${broadcastId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
