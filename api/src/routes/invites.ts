import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { workspaceInvites, workspaceMembers, workspaces, user } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { getResend } from "../lib/resend.js";
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
    const resend = getResend();
    await resend.emails.send({
      from: process.env.FROM_EMAIL ?? "OpenMail <noreply@openmail.dev>",
      to: email,
      subject: `You've been invited to join ${workspace?.name ?? "a workspace"} on OpenMail`,
      html: buildInviteEmail({ workspaceName: workspace?.name ?? "a workspace", inviteUrl, role, email }),
    }).catch(() => {});

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

function buildInviteEmail({ workspaceName, inviteUrl, role, email }: { workspaceName: string; inviteUrl: string; role: string; email: string }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're invited</title>
  <style>
    body { margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 520px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb; }
    .header { background: #08080a; padding: 32px 40px; }
    .logo-text { color: #ffffff; font-size: 16px; font-weight: 600; letter-spacing: -0.02em; }
    .body { padding: 40px; }
    h1 { margin: 0 0 12px; font-size: 22px; font-weight: 600; color: #111827; letter-spacing: -0.02em; }
    p { margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #6b7280; }
    .highlight { color: #374151; font-weight: 500; }
    .button { display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; }
    .divider { border: none; border-top: 1px solid #f3f4f6; margin: 28px 0; }
    .footer { padding: 0 40px 32px; }
    .footer p { font-size: 13px; color: #9ca3af; margin: 0 0 8px; }
    .link { color: #6366f1; text-decoration: none; word-break: break-all; font-size: 13px; }
    .expiry { font-size: 13px; color: #9ca3af; margin-top: 4px; }
    .role-badge { display: inline-block; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px; padding: 2px 8px; font-size: 12px; font-weight: 500; color: #374151; text-transform: capitalize; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="logo-text">OpenMail</span>
    </div>
    <div class="body">
      <h1>You've been invited</h1>
      <p>You've been invited to join <span class="highlight">${workspaceName}</span> on OpenMail as a <span class="role-badge">${role}</span>.</p>
      <p>Click the button below to accept the invitation and start collaborating.</p>
      <a href="${inviteUrl}" class="button">Accept invitation</a>
      <hr class="divider" />
    </div>
    <div class="footer">
      <p>If the button doesn't work, copy and paste this link:</p>
      <a href="${inviteUrl}" class="link">${inviteUrl}</a>
      <p class="expiry">This invitation expires in 7 days. If you weren't expecting this, you can ignore it.</p>
    </div>
  </div>
</body>
</html>`;
}

export default app;
