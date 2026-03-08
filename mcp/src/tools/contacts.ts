import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { getApiClient } from "../lib/api-client.js";

export function registerContactTools(server: McpServer, getClient: () => ReturnType<typeof getApiClient>) {
  server.tool(
    "list_contacts",
    "List contacts in the workspace. Supports search and pagination.",
    {
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 50)"),
      search: z.string().optional().describe("Search by email"),
    },
    async ({ page, pageSize, search }) => {
      const params = new URLSearchParams();
      if (page) params.set("page", String(page));
      if (pageSize) params.set("pageSize", String(pageSize));
      if (search) params.set("search", search);
      const data = await getClient().get(`/contacts?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "create_contact",
    "Create or update a contact by email (upsert).",
    {
      email: z.string().email().describe("Contact email address"),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      attributes: z.record(z.unknown()).optional().describe("Custom attributes (plan, company, etc.)"),
    },
    async (body) => {
      const data = await getClient().post("/contacts", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "update_contact",
    "Update contact attributes by contact ID.",
    {
      contactId: z.string().describe("Contact ID (con_xxx)"),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      attributes: z.record(z.unknown()).optional(),
    },
    async ({ contactId, ...body }) => {
      const data = await getClient().patch(`/contacts/${contactId}`, body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "delete_contact",
    "Permanently delete a contact.",
    { contactId: z.string().describe("Contact ID (con_xxx)") },
    async ({ contactId }) => {
      await getClient().delete(`/contacts/${contactId}`);
      return { content: [{ type: "text", text: `Contact ${contactId} deleted.` }] };
    }
  );

  server.tool(
    "track_event",
    "Track a customer event (e.g. signed_up, upgraded, churned).",
    {
      email: z.string().email().describe("Contact email"),
      name: z.string().describe("Event name (snake_case recommended)"),
      properties: z.record(z.unknown()).optional().describe("Event properties"),
    },
    async (body) => {
      const data = await getClient().post("/events/track", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
