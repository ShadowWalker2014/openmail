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
import sendsRouter from "./routes/sends.js";
import ingestRouter from "./routes/ingest.js";
import groupsRouter from "./routes/groups.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { workspaceInvites, workspaceMembers, assets as assetsSchema } from "@openmail/shared/schema";
import { eq, and, gt } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import { getObject } from "./lib/storage.js";
import { logger } from "./lib/logger.js";
import type { ApiVariables } from "./types.js";

const app = new Hono<{ Variables: ApiVariables }>();

// /api/ingest/* is called from external customer apps (browser/server SDKs).
// MUST be registered BEFORE the global dashboard cors — Hono's cors middleware
// short-circuits OPTIONS without calling next(), so the global cors would block
// all ingest preflights from external origins if it ran first.
app.use("/api/ingest/*", cors({
  origin: "*",
  credentials: false,
  allowHeaders: ["Content-Type", "Authorization"],
  // FIX (HIGH): PUT is required for Customer.io SDK compatibility.
  // PUT /cio/v1/customers/:id   — identify (SDK default method)
  // PUT /cio/v1/objects/:t/:id  — Objects API group upsert
  // PUT /cio/v1/objects/:t/:id/relationships — link contacts to group
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}));

// Dashboard cors — scoped to the configured WEB_URL origin only
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
sessionApi.route("/ws/:workspaceId/sends", sendsRouter);
sessionApi.route("/ws/:workspaceId/groups", groupsRouter);
sessionApi.route("/invites", inviteAcceptRouter);

app.route("/api/session", sessionApi);

// Public asset proxy — no auth needed so email clients can load images
// URL: /api/public/assets/:workspaceId/:assetId
app.get("/api/public/assets/:workspaceId/:assetId", async (c) => {
  const { workspaceId, assetId } = c.req.param();
  const db = getDb();
  const [asset] = await db
    .select({ s3Key: assetsSchema.s3Key, mimeType: assetsSchema.mimeType })
    .from(assetsSchema)
    .where(and(eq(assetsSchema.id, assetId), eq(assetsSchema.workspaceId, workspaceId)))
    .limit(1);
  if (!asset) return c.json({ error: "Not found" }, 404);

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
apiKeyApi.route("/groups", groupsRouter);
apiKeyApi.route("/assets", assetsRouter);

app.route("/api/v1", apiKeyApi);

// Ingest API — public-facing, handles its own auth (Bearer / Basic / body api_key)
// Compatible with PostHog and Customer.io SDK formats
app.route("/api/ingest", ingestRouter);

// Resend webhook — public-facing, auth via Svix signature (RESEND_WEBHOOK_SECRET)
// Handles email.bounced and email.complained events
app.route("/api/webhooks/resend", webhooksRouter);

// Exported for integration tests — same app instance used in production
export { app };

// Run idempotent migrations at startup
async function runStartupMigrations() {
  const db = getDb();

  // Legacy column additions
  await db.execute(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS logo_url TEXT`);

  // Groups tables (added for group identify — PostHog + Customer.io compat)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS groups (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      group_type   TEXT NOT NULL DEFAULT 'company',
      group_key    TEXT NOT NULL,
      attributes   JSONB DEFAULT '{}'::jsonb,
      created_at   TIMESTAMP NOT NULL DEFAULT now(),
      updated_at   TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS groups_workspace_type_key_idx
    ON groups (workspace_id, group_type, group_key)
  `);

  await db.execute(`CREATE INDEX IF NOT EXISTS groups_workspace_idx ON groups (workspace_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS contact_groups (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      contact_id   TEXT NOT NULL REFERENCES contacts(id)  ON DELETE CASCADE,
      group_id     TEXT NOT NULL REFERENCES groups(id)    ON DELETE CASCADE,
      role         TEXT,
      created_at   TIMESTAMP NOT NULL DEFAULT now(),
      PRIMARY KEY (contact_id, group_id)
    )
  `);

  await db.execute(`CREATE INDEX IF NOT EXISTS contact_groups_group_idx      ON contact_groups (group_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS contact_groups_workspace_idx   ON contact_groups (workspace_id)`);

  // Segment membership snapshot (for segment_enter / segment_exit campaign triggers)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS segment_memberships (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      segment_id   TEXT NOT NULL REFERENCES segments(id)   ON DELETE CASCADE,
      contact_id   TEXT NOT NULL REFERENCES contacts(id)   ON DELETE CASCADE,
      created_at   TIMESTAMP NOT NULL DEFAULT now(),
      PRIMARY KEY (segment_id, contact_id)
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS seg_mem_workspace_idx ON segment_memberships (workspace_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS seg_mem_contact_idx   ON segment_memberships (contact_id)`);

  // Resend webhook counters on broadcasts (added for bounce/complaint tracking)
  await db.execute(`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS bounce_count INTEGER NOT NULL DEFAULT 0`);
  await db.execute(`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS complaint_count INTEGER NOT NULL DEFAULT 0`);

  // Performance indexes (DB-1 through DB-5)
  await db.execute(`CREATE INDEX IF NOT EXISTS email_sends_resend_msg_idx  ON email_sends (resend_message_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS email_sends_campaign_idx    ON email_sends (campaign_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS email_sends_created_at_idx  ON email_sends (created_at)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS email_events_occurred_at_idx ON email_events (occurred_at)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS contacts_unsubscribed_idx   ON contacts (unsubscribed)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS broadcasts_status_idx       ON broadcasts (status)`);

  logger.info("Startup migrations OK");
}

const port = Number(process.env.PORT ?? 3001);
logger.info({ port }, "API server starting");

runStartupMigrations().catch((err) => { logger.fatal({ err }, "Startup migration failed — exiting"); process.exit(1); });

export default { port, fetch: app.fetch };
