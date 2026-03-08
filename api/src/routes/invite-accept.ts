import { Hono } from "hono";
import { getDb } from "@openmail/shared/db";
import { workspaceInvites, workspaceMembers, user } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and, gt } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

// POST /accept/:token — accept an invite (must be logged in)
app.post("/accept/:token", async (c) => {
  const userId = c.get("userId") as string;
  const token = c.req.param("token");
  const db = getDb();

  const [invite] = await db
    .select()
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.token, token), gt(workspaceInvites.expiresAt, new Date())))
    .limit(1);

  if (!invite) return c.json({ error: "Invite not found or expired" }, 404);

  const [currentUser] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!currentUser) return c.json({ error: "User not found" }, 404);

  if (currentUser.email !== invite.email) {
    return c.json({ error: "This invite was sent to a different email address" }, 403);
  }

  // Check if already a member
  const [existing] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, invite.workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);

  if (existing) {
    // Already a member — delete invite and return success
    await db.delete(workspaceInvites).where(eq(workspaceInvites.id, invite.id));
    return c.json({ workspaceId: invite.workspaceId });
  }

  // Add to workspace
  await db.insert(workspaceMembers).values({
    id: generateId("wm"),
    workspaceId: invite.workspaceId,
    userId,
    role: invite.role,
  });

  // Delete used invite
  await db.delete(workspaceInvites).where(eq(workspaceInvites.id, invite.id));

  return c.json({ workspaceId: invite.workspaceId });
});

// GET /info/:token — public invite info (for showing the invite page)
app.get("/info/:token", async (c) => {
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

export default app;
