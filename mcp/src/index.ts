import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerContactTools } from "./tools/contacts.js";
import { registerBroadcastTools } from "./tools/broadcasts.js";
import { registerCampaignTools } from "./tools/campaigns.js";
import { registerLifecycleTools } from "./tools/lifecycle.js";
import { registerGoalTools } from "./tools/goals.js";
import { registerTemplateTools } from "./tools/templates.js";
import { registerSegmentTools } from "./tools/segments.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerAssetTools } from "./tools/assets.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { getApiClient } from "./lib/api-client.js";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const app = new Hono();

app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id"],
}));

app.get("/health", (c) => c.json({ status: "ok", service: "mcp" }));

app.post("/mcp", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header. Use: Bearer <workspace-api-key>" }, 401);
  }

  const apiKey = authHeader.slice(7);
  const client = getApiClient(apiKey);

  const server = new McpServer({
    name: "openmail",
    version: "1.0.0",
    description: "OpenMail — email marketing automation platform API",
  });

  // Tools (contacts, broadcasts, campaigns, lifecycle, templates, segments, analytics, assets).
  // Lifecycle tools (Stage 2) register `resume_campaign`, `stop_campaign`,
  // `archive_campaign` only — `pause_campaign` is registered exclusively by
  // the campaigns module (which now routes through the audited PATCH alias).
  // MCP SDK requires unique tool names so we cannot register pause twice.
  registerContactTools(server, () => client);
  registerBroadcastTools(server, () => client);
  registerCampaignTools(server, () => client);
  registerLifecycleTools(server, () => client);
  registerGoalTools(server, () => client);
  registerTemplateTools(server, () => client);
  registerSegmentTools(server, () => client);
  registerAnalyticsTools(server, () => client);
  registerAssetTools(server, () => client);

  // Prompts — reusable message templates for common OpenMail workflows
  registerPrompts(server);

  // Resources — docs index fetched live from llms.txt + quick-reference card
  registerResources(server);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session persistence
  });

  await server.connect(transport);

  return transport.handleRequest(c.req.raw);
});

// SSE endpoint for streaming (GET /mcp)
app.get("/mcp", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }
  return c.json({ error: "Use POST /mcp for MCP requests" }, 405);
});

// Exported for integration / unit tests
export { app };

const port = Number(process.env.PORT ?? 3002);
logger.info({ port }, "MCP server starting");

export default { port, fetch: app.fetch };
