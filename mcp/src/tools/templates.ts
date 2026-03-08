import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { getApiClient } from "../lib/api-client.js";

export function registerTemplateTools(server: McpServer, getClient: () => ReturnType<typeof getApiClient>) {
  server.tool("list_templates", "List all email templates.", {}, async () => {
    const data = await getClient().get("/templates");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool(
    "create_template",
    "Create a new email template.",
    {
      name: z.string(),
      subject: z.string(),
      htmlContent: z.string(),
      previewText: z.string().optional(),
    },
    async (body) => {
      const data = await getClient().post("/templates", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "update_template",
    "Update an existing email template.",
    {
      templateId: z.string(),
      name: z.string().optional(),
      subject: z.string().optional(),
      htmlContent: z.string().optional(),
    },
    async ({ templateId, ...body }) => {
      const data = await getClient().patch(`/templates/${templateId}`, body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
