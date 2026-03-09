import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { emailTemplates, workspaces } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and } from "drizzle-orm";
import { Resend } from "resend";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  return c.json(await db.select().from(emailTemplates).where(eq(emailTemplates.workspaceId, workspaceId)));
});

app.post(
  "/",
  zValidator("json", z.object({
    name: z.string().min(1),
    subject: z.string().min(1),
    previewText: z.string().optional(),
    htmlContent: z.string().default(""),
    jsonContent: z.unknown().optional(),
    isVisual: z.boolean().optional().default(false),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const body = c.req.valid("json");
    const db = getDb();
    const [tmpl] = await db.insert(emailTemplates).values({ id: generateId("tpl"), workspaceId, ...body }).returning();
    return c.json(tmpl, 201);
  }
);

app.patch(
  "/:id",
  zValidator("json", z.object({
    name: z.string().optional(),
    subject: z.string().optional(),
    previewText: z.string().optional(),
    htmlContent: z.string().optional(),
    jsonContent: z.unknown().optional(),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const db = getDb();
    const [tmpl] = await db
      .update(emailTemplates)
      .set({ ...c.req.valid("json"), updatedAt: new Date() })
      .where(and(eq(emailTemplates.id, c.req.param("id")), eq(emailTemplates.workspaceId, workspaceId)))
      .returning();
    if (!tmpl) return c.json({ error: "Not found" }, 404);
    return c.json(tmpl);
  }
);

app.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  await db.delete(emailTemplates).where(and(eq(emailTemplates.id, c.req.param("id")), eq(emailTemplates.workspaceId, workspaceId)));
  return c.json({ success: true });
});

app.post(
  "/send-test",
  zValidator("json", z.object({
    to: z.string().email(),
    subject: z.string().min(1),
    htmlContent: z.string(),
    prependTest: z.boolean().default(true),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const { to, subject, htmlContent, prependTest } = c.req.valid("json");
    const db = getDb();

    const [ws] = await db
      .select({
        resendApiKey: workspaces.resendApiKey,
        resendFromEmail: workspaces.resendFromEmail,
        resendFromName: workspaces.resendFromName,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (!ws) return c.json({ error: "Workspace not found" }, 404);

    const apiKey = ws.resendApiKey ?? process.env.RESEND_API_KEY;
    if (!apiKey) return c.json({ error: "No Resend API key configured. Set one in Settings → Email Sending." }, 400);

    const fromEmail = ws.resendFromEmail ?? process.env.PLATFORM_FROM_EMAIL ?? "noreply@openmail.dev";
    const fromName = ws.resendFromName ?? process.env.PLATFORM_FROM_NAME ?? "OpenMail";

    const finalSubject = prependTest ? `[TEST] ${subject}` : subject;

    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to,
      subject: finalSubject,
      html: htmlContent || "<p>No content</p>",
    });

    if (error) return c.json({ error: error.message }, 400);

    return c.json({ success: true });
  }
);

export default app;
