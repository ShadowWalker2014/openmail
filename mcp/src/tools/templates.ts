import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { getApiClient } from "../lib/api-client.js";

export function registerTemplateTools(server: McpServer, getClient: () => ReturnType<typeof getApiClient>) {
  server.tool(
    "list_templates",
    "List all email templates in the workspace.",
    {},
    async () => {
      const data = await getClient().get("/templates");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "create_template",
    `Create a reusable email template that can be used by broadcasts and campaigns.
To include images, first upload them with upload_asset_from_url and use the returned proxyUrl:
  <img src="{proxyUrl}" alt="..." style="max-width:100%;display:block">
The proxyUrl is permanently public and safe for any email client.`,
    {
      name:        z.string().describe("Template name shown in the dashboard"),
      subject:     z.string().describe("Default email subject line (can be overridden per broadcast)"),
      htmlContent: z.string().describe("Full HTML email body. Reference uploaded assets via their proxyUrl."),
      previewText: z.string().optional().describe("Preview/preheader text shown in email clients before opening"),
    },
    async (body) => {
      const data = await getClient().post("/templates", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "update_template",
    "Update an existing email template. Only the fields you provide will be changed.",
    {
      templateId:  z.string().describe("Template ID (tpl_xxx)"),
      name:        z.string().optional().describe("New template name"),
      subject:     z.string().optional().describe("New default subject line"),
      htmlContent: z.string().optional().describe("New HTML email body"),
      previewText: z.string().optional().describe("New preview/preheader text"),
    },
    async ({ templateId, ...body }) => {
      const data = await getClient().patch(`/templates/${templateId}`, body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "delete_template",
    "Permanently delete an email template. Broadcasts referencing this template will lose their template association.",
    { templateId: z.string().describe("Template ID (tpl_xxx)") },
    async ({ templateId }) => {
      const data = await getClient().delete(`/templates/${templateId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
