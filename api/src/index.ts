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
import shapesRouter from "./routes/shapes.js";
import domainsRouter from "./routes/domains.js";
import membersRouter from "./routes/members.js";
import invitesRouter from "./routes/invites.js";
import inviteAcceptRouter from "./routes/invite-accept.js";
import assetsRouter from "./routes/assets.js";
import { workspaceInvites, workspaceMembers } from "@openmail/shared/schema";
import { eq, and, gt } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import { logger } from "./lib/logger.js";
import type { ApiVariables } from "./types.js";

const app = new Hono<{ Variables: ApiVariables }>();

app.use("*", cors({
  origin: (origin) => {
    const allowed = [process.env.WEB_URL ?? "http://localhost:5173"];
    return allowed.includes(origin) ? origin : null;
  },
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
}));
app.use("*", honoLogger());

app.get("/health", (c) => c.json({ status: "ok", service: "api" }));

// Public: get invite info by token (no auth needed — shown on the invite acceptance page)
app.get("/api/invites/info/:token", async (c) => {
  const token = c.req.param("token");
  const db = getDb();
  const [invite] = await db
    .select({
      id: workspaceInvites.id,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      expiresAt: workspaceInvites.expiresAt,
      workspaceId: workspaceInvites.workspaceId,
    })
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.token, token), gt(workspaceInvites.expiresAt, new Date())))
    .limit(1);
  if (!invite) return c.json({ error: "Invite not found or expired" }, 404);
  return c.json(invite);
});

// Handle both /auth/* and /api/auth/* (Better Auth default base path)
const authHandler = async (c: any) => {
  const { getAuth } = await import("./lib/auth.js");
  return getAuth().handler(c.req.raw);
};
app.all("/auth/*", authHandler);
app.all("/api/auth/*", authHandler);

const sessionApi = new Hono<{ Variables: ApiVariables }>();
sessionApi.use("*", sessionAuth);
sessionApi.route("/workspaces", workspacesRouter);

// Workspace membership guard — every /ws/:workspaceId/* route requires the
// authenticated user to be a member of that workspace.
sessionApi.use("/ws/:workspaceId/*", async (c, next) => {
  const workspaceId = c.req.param("workspaceId");
  const userId = c.get("userId") as string;
  const db = getDb();
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!member) return c.json({ error: "Forbidden" }, 403);
  c.set("workspaceId", workspaceId);
  c.set("workspaceMember", member);
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
sessionApi.route("/ws/:workspaceId/shapes", shapesRouter);
sessionApi.route("/ws/:workspaceId/domains", domainsRouter);
sessionApi.route("/ws/:workspaceId/members", membersRouter);
sessionApi.route("/ws/:workspaceId/invites", invitesRouter);
sessionApi.route("/ws/:workspaceId/assets", assetsRouter);
sessionApi.route("/invites", inviteAcceptRouter);

app.route("/api/session", sessionApi);

// Public asset proxy — no auth needed so email clients can load images
// URL: /api/public/assets/:workspaceId/:assetId
app.get("/api/public/assets/:workspaceId/:assetId", async (c) => {
  const { workspaceId, assetId } = c.req.param();
  const db = getDb();
  const { assets } = await import("@openmail/shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const [asset] = await db
    .select({ s3Key: assets.s3Key, mimeType: assets.mimeType })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.workspaceId, workspaceId)))
    .limit(1);
  if (!asset) return c.json({ error: "Not found" }, 404);

  const { getObject } = await import("./lib/storage.js");
  const obj = await getObject(asset.s3Key);
  if (!obj) return c.json({ error: "File not found in storage" }, 404);

  return new Response(obj.body as BodyInit, {
    headers: {
      "Content-Type": obj.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(obj.contentLength),
    },
  });
});

// Global error handler — prevents internal details from leaking to clients
app.onError((err, c) => {
  logger.error({ err }, "Unhandled API error");
  return c.json({ error: "Internal server error" }, 500);
});

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

// Exported for integration tests — same app instance used in production
export { app };

const port = Number(process.env.PORT ?? 3001);
logger.info({ port }, "API server starting");

export default { port, fetch: app.fetch };
