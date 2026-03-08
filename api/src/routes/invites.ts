import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { workspaceInvites, workspaceMembers, workspaces, user } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { sendWorkspaceInviteEmail } from "../lib/mailer.js";
import { eq, and, gt } from "drizzle-orm";
import { randomBytes } from "crypto";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

// GET / — list pending invites for workspace (admin/owner only)
app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const requestingMember = c.get("workspaceMember") as { role: string };
  if (requestingMember.role !== "owner" && requestingMember.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }
  const db = getDb();
  const invites = await db
    .select()
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.workspaceId, workspaceId), gt(workspaceInvites.expiresAt, new Date())));
  return c.json(invites);
});

// POST / — create and send invite
app.post(
  "/",
  zValidator("json", z.object({
    email: z.string().email(),
    role: z.enum(["admin", "member"]).default("member"),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const requestingMember = c.get("workspaceMember") as { role: string };
    if (requestingMember.role !== "owner" && requestingMember.role !== "admin") {
      return c.json({ error: "Forbidden" }, 403);
    }

    const { email, role } = c.req.valid("json");
    const db = getDb();

    // Check if user is already a member
    const [existingUser] = await db.select().from(user).where(eq(user.email, email)).limit(1);
    if (existingUser) {
      const [existingMember] = await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, existingUser.id)))
        .limit(1);
      if (existingMember) return c.json({ error: "User is already a member" }, 409);
    }

    const [workspace] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const id = generateId("inv");

    await db.insert(workspaceInvites).values({ id, workspaceId, email, role, token, expiresAt });

    const webUrl = process.env.WEB_URL ?? "http://localhost:5173"; // pragma: allowlist secret
    const inviteUrl = `${webUrl}/invite/${token}`;
    await sendWorkspaceInviteEmail({
      to: email,
      inviteUrl,
      workspaceName: workspace?.name ?? "a workspace",
      role,
    }).catch(() => {}); // don't block the response on email failure

    return c.json({ id, email, role, token, expiresAt }, 201);
  }
);

// DELETE /:inviteId — cancel an invite
app.delete("/:inviteId", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const requestingMember = c.get("workspaceMember") as { role: string };
  if (requestingMember.role !== "owner" && requestingMember.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }
  const db = getDb();
  const [deleted] = await db
    .delete(workspaceInvites)
    .where(and(eq(workspaceInvites.id, c.req.param("inviteId")), eq(workspaceInvites.workspaceId, workspaceId)))
    .returning({ id: workspaceInvites.id });
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export default app;
