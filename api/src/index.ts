import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { workspaceApiKeyAuth } from "./middleware/workspace-auth.js";
import { sessionAuth } from "./middleware/session-auth.js";
import workspacesRouter from "./routes/workspaces.js";
import contactsRouter from "./routes/contacts.js";
import eventsRouter from "./routes/events.js";
import broadcastsRouter from "./routes/broadcasts.js";
import templatesRouter from "./routes/templates.js";
import campaignsRouter from "./routes/campaigns.js";
import segmentsRouter from "./routes/segments.js";
import apiKeysRouter from "./routes/api-keys.js";
import analyticsRouter from "./routes/analytics.js";
import { logger } from "./lib/logger.js";
import type { ApiVariables } from "./types.js";

const app = new Hono<{ Variables: ApiVariables }>();

app.use("*", cors({
  origin: (origin) => {
    const allowed = [process.env.WEB_URL ?? "http://localhost:5173"];
    return allowed.includes(origin) ? origin : allowed[0];
  },
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
}));
app.use("*", honoLogger());

app.get("/health", (c) => c.json({ status: "ok", service: "api" }));

app.all("/auth/*", async (c) => {
  const { getAuth } = await import("./lib/auth.js");
  return getAuth().handler(c.req.raw);
});

const sessionApi = new Hono<{ Variables: ApiVariables }>();
sessionApi.use("*", sessionAuth);
sessionApi.route("/workspaces", workspacesRouter);

sessionApi.use("/ws/:workspaceId/*", async (c, next) => {
  c.set("workspaceId", c.req.param("workspaceId"));
  await next();
});
sessionApi.route("/ws/:workspaceId/contacts", contactsRouter);
sessionApi.route("/ws/:workspaceId/events", eventsRouter);
sessionApi.route("/ws/:workspaceId/broadcasts", broadcastsRouter);
sessionApi.route("/ws/:workspaceId/templates", templatesRouter);
sessionApi.route("/ws/:workspaceId/campaigns", campaignsRouter);
sessionApi.route("/ws/:workspaceId/segments", segmentsRouter);
sessionApi.route("/ws/:workspaceId/api-keys", apiKeysRouter);
sessionApi.route("/ws/:workspaceId/analytics", analyticsRouter);

app.route("/api/session", sessionApi);

const apiKeyApi = new Hono<{ Variables: ApiVariables }>();
apiKeyApi.use("*", workspaceApiKeyAuth);
apiKeyApi.route("/contacts", contactsRouter);
apiKeyApi.route("/events", eventsRouter);
apiKeyApi.route("/broadcasts", broadcastsRouter);
apiKeyApi.route("/templates", templatesRouter);
apiKeyApi.route("/campaigns", campaignsRouter);
apiKeyApi.route("/segments", segmentsRouter);
apiKeyApi.route("/analytics", analyticsRouter);

app.route("/api/v1", apiKeyApi);

const port = Number(process.env.PORT ?? 3001);
logger.info({ port }, "API server starting");

export default { port, fetch: app.fetch };
