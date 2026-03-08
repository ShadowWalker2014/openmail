import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { getApiClient } from "../lib/api-client.js";

export function registerSegmentTools(server: McpServer, getClient: () => ReturnType<typeof getApiClient>) {
  server.tool(
    "list_segments",
    "List all contact segments in the workspace.",
    {},
    async () => {
      const data = await getClient().get("/segments");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "create_segment",
    "Create a new contact segment with conditions.",
    {
      name: z.string().describe("Segment name"),
      description: z.string().optional(),
      conditions: z.array(z.object({
        field: z.string().describe("Field to evaluate (e.g. 'attributes.plan', 'email')"),
        operator: z.enum(["eq", "ne", "gt", "lt", "gte", "lte", "contains", "not_contains", "exists", "not_exists"]),
        value: z.union([z.string(), z.number(), z.boolean()]).optional(),
      })).describe("List of conditions to filter contacts"),
      conditionLogic: z.enum(["and", "or"]).optional().describe("How to combine conditions: 'and' (all must match) or 'or' (any must match)"),
    },
    async (body) => {
      const data = await getClient().post("/segments", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
