import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { workspaceMembers, user } from "@openmail/shared/schema";
import { eq, and } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

// GET / — list all members of the workspace with user info
app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const members = await db
    .select({
      id: workspaceMembers.id,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
      userId: workspaceMembers.userId,
      userName: user.name,
      userEmail: user.email,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(workspaceMembers.userId, user.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  return c.json(members);
});

// PATCH /:memberId — change role (owner/admin only)
app.patch(
  "/:memberId",
  zValidator("json", z.object({ role: z.enum(["admin", "member"]) })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const requestingMember = c.get("workspaceMember") as { role: string };
    if (requestingMember.role !== "owner" && requestingMember.role !== "admin") {
      return c.json({ error: "Forbidden: admin or owner required" }, 403);
    }
    const { role } = c.req.valid("json");
    const db = getDb();
    const [updated] = await db
      .update(workspaceMembers)
      .set({ role })
      .where(and(eq(workspaceMembers.id, c.req.param("memberId")), eq(workspaceMembers.workspaceId, workspaceId)))
      .returning();
    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json(updated);
  }
);

// DELETE /:memberId — remove member (owner/admin) or leave workspace (self)
app.delete("/:memberId", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  const requestingMember = c.get("workspaceMember") as { id: string; role: string };
  const memberId = c.req.param("memberId");
  const db = getDb();

  const [target] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);

  if (!target) return c.json({ error: "Not found" }, 404);

  // Owners cannot be removed (they must transfer ownership first)
  if (target.role === "owner") return c.json({ error: "Cannot remove workspace owner" }, 400);

  // Only owner/admin can remove others; anyone can remove themselves
  const isSelf = target.userId === userId;
  if (!isSelf && requestingMember.role !== "owner" && requestingMember.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }

  await db.delete(workspaceMembers).where(eq(workspaceMembers.id, memberId));
  return c.json({ success: true });
});

export default app;
