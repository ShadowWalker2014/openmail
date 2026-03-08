import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Resend } from "resend";
import { getDb } from "@openmail/shared/db";
import { workspaces, workspaceMembers } from "@openmail/shared/schema";
import type { DomainRecord } from "@openmail/shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

// Ensure the session user is owner/admin of this workspace
async function assertOwnerOrAdmin(workspaceId: string, userId: string) {
  const db = getDb();
  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return member && (member.role === "owner" || member.role === "admin");
}

async function getWorkspaceFull(workspaceId: string) {
  const db = getDb();
  const [workspace] = await db
    .select({
      resendApiKey: workspaces.resendApiKey,
      resendDomainId: workspaces.resendDomainId,
      resendDomainName: workspaces.resendDomainName,
      resendDomainStatus: workspaces.resendDomainStatus,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return workspace ?? null;
}

// POST /connect — register a new sending domain with Resend and store DNS records
app.post(
  "/connect",
  zValidator("json", z.object({
    domainName: z
      .string()
      .min(3)
      .regex(
        /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)+$/,
        "Invalid domain name",
      ),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId")!;
    const { domainName } = c.req.valid("json");

    if (!(await assertOwnerOrAdmin(workspaceId, userId))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const db = getDb();
    const workspace = await getWorkspaceFull(workspaceId);
    if (!workspace) return c.json({ error: "Workspace not found" }, 404);

    if (!workspace.resendApiKey) {
      return c.json(
        { error: "Configure your Resend API key in settings before connecting a domain." },
        400,
      );
    }

    // If a domain is already connected, block connecting another without disconnecting first
    if (workspace.resendDomainId) {
      return c.json(
        { error: "A domain is already connected. Disconnect it before adding a new one." },
        409,
      );
    }

    const resend = new Resend(workspace.resendApiKey);
    const { data, error } = await resend.domains.create({ name: domainName });

    if (error || !data) {
      logger.warn({ error, domainName, workspaceId }, "Resend domain create failed");
      return c.json({ error: error?.message ?? "Failed to connect domain with Resend." }, 400);
    }

    await db.update(workspaces).set({
      resendDomainId: data.id,
      resendDomainName: data.name,
      resendDomainStatus: data.status,
      resendDomainRecords: (data.records ?? []) as DomainRecord[],
      updatedAt: new Date(),
    }).where(eq(workspaces.id, workspaceId));

    return c.json({
      id: data.id,
      name: data.name,
      status: data.status,
      records: data.records ?? [],
    }, 201);
  },
);

// POST /verify — trigger async verification on Resend; domain goes to "pending"
app.post("/verify", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId")!;

  if (!(await assertOwnerOrAdmin(workspaceId, userId))) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const workspace = await getWorkspaceFull(workspaceId);
  if (!workspace?.resendDomainId) {
    return c.json({ error: "No domain connected. Connect a domain first." }, 400);
  }
  if (!workspace.resendApiKey) {
    return c.json({ error: "Resend API key not configured." }, 400);
  }

  const resend = new Resend(workspace.resendApiKey);
  const { error } = await resend.domains.verify(workspace.resendDomainId);

  if (error) {
    logger.warn({ error, workspaceId }, "Resend domain verify failed");
    return c.json({ error: error.message ?? "Verification request failed." }, 400);
  }

  const db = getDb();
  await db.update(workspaces).set({
    resendDomainStatus: "pending",
    updatedAt: new Date(),
  }).where(eq(workspaces.id, workspaceId));

  return c.json({ status: "pending" });
});

// POST /refresh — poll current status + updated DNS record statuses from Resend
app.post("/refresh", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId")!;

  if (!(await assertOwnerOrAdmin(workspaceId, userId))) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const workspace = await getWorkspaceFull(workspaceId);
  if (!workspace?.resendDomainId) {
    return c.json({ error: "No domain connected." }, 400);
  }
  if (!workspace.resendApiKey) {
    return c.json({ error: "Resend API key not configured." }, 400);
  }

  const resend = new Resend(workspace.resendApiKey);
  const { data, error } = await resend.domains.get(workspace.resendDomainId);

  if (error || !data) {
    logger.warn({ error, workspaceId }, "Resend domain get failed");
    return c.json({ error: error?.message ?? "Failed to fetch domain status." }, 400);
  }

  const db = getDb();
  await db.update(workspaces).set({
    resendDomainStatus: data.status,
    resendDomainRecords: (data.records ?? []) as DomainRecord[],
    updatedAt: new Date(),
  }).where(eq(workspaces.id, workspaceId));

  return c.json({
    id: data.id,
    name: data.name,
    status: data.status,
    records: data.records ?? [],
  });
});

// DELETE / — disconnect domain: remove from Resend + clear from DB
app.delete("/", async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId")!;

  if (!(await assertOwnerOrAdmin(workspaceId, userId))) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const workspace = await getWorkspaceFull(workspaceId);
  if (!workspace?.resendDomainId) {
    return c.json({ error: "No domain connected." }, 400);
  }
  if (!workspace.resendApiKey) {
    return c.json({ error: "Resend API key not configured." }, 400);
  }

  const resend = new Resend(workspace.resendApiKey);
  const { error } = await resend.domains.remove(workspace.resendDomainId);

  // If Resend says domain not found, still clear our DB — it's already gone
  if (error && !error.message?.toLowerCase().includes("not found")) {
    logger.warn({ error, workspaceId }, "Resend domain delete failed");
    return c.json({ error: error.message ?? "Failed to disconnect domain." }, 400);
  }

  const db = getDb();
  await db.update(workspaces).set({
    resendDomainId: null,
    resendDomainName: null,
    resendDomainStatus: null,
    resendDomainRecords: null,
    updatedAt: new Date(),
  }).where(eq(workspaces.id, workspaceId));

  return new Response(null, { status: 204 });
});

export default app;
