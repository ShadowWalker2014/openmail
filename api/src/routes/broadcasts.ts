import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { broadcasts, emailSends } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and, count, desc, sql } from "drizzle-orm";
import { Queue } from "bullmq";
import { getQueueRedisConnection } from "../lib/redis.js";
import type { ApiVariables } from "../types.js";

let _broadcastQueue: Queue | null = null;
function getBroadcastQueue() {
  if (!_broadcastQueue) _broadcastQueue = new Queue("broadcasts", { connection: getQueueRedisConnection() });
  return _broadcastQueue;
}

const app = new Hono<{ Variables: ApiVariables }>();

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  return c.json(await db.select().from(broadcasts).where(eq(broadcasts.workspaceId, workspaceId)));
});

app.get("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [broadcast] = await db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.id, c.req.param("id")), eq(broadcasts.workspaceId, workspaceId)))
    .limit(1);
  if (!broadcast) return c.json({ error: "Not found" }, 404);
  return c.json(broadcast);
});

app.post(
  "/",
  zValidator("json", z.object({
    name: z.string().min(1),
    subject: z.string().min(1),
    templateId: z.string().optional(),
    htmlContent: z.string().optional(),
    fromEmail: z.string().email().optional(),
    fromName: z.string().optional(),
    segmentIds: z.array(z.string()).min(1),
    scheduledAt: z.string().datetime().optional(),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const body = c.req.valid("json");
    const db = getDb();
    const id = generateId("brd");
    const [broadcast] = await db
      .insert(broadcasts)
      .values({ id, workspaceId, ...body, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null })
      .returning();
    return c.json(broadcast, 201);
  }
);

app.patch(
  "/:id",
  zValidator("json", z.object({
    name: z.string().optional(),
    subject: z.string().optional(),
    templateId: z.string().optional(),
    htmlContent: z.string().optional(),
    fromEmail: z.string().email().optional(),
    fromName: z.string().optional(),
    segmentIds: z.array(z.string()).optional(),
    scheduledAt: z.string().datetime().optional(),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const db = getDb();
    const [broadcast] = await db
      .select()
      .from(broadcasts)
      .where(and(eq(broadcasts.id, c.req.param("id")), eq(broadcasts.workspaceId, workspaceId)))
      .limit(1);
    if (!broadcast) return c.json({ error: "Not found" }, 404);
    if (broadcast.status !== "draft") return c.json({ error: "Can only edit draft broadcasts" }, 400);

    const body = c.req.valid("json");
    const [updated] = await db
      .update(broadcasts)
      .set({ ...body, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined, updatedAt: new Date() })
      .where(and(eq(broadcasts.id, c.req.param("id")), eq(broadcasts.workspaceId, workspaceId)))
      .returning();
    return c.json(updated);
  }
);

app.post("/:id/send", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [broadcast] = await db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.id, c.req.param("id")), eq(broadcasts.workspaceId, workspaceId)))
    .limit(1);

  if (!broadcast) return c.json({ error: "Not found" }, 404);

  // Atomic check-and-set: only update if still in draft status.
  // Adding eq(broadcasts.status, "draft") to the WHERE clause prevents
  // two concurrent requests from both enqueuing the same broadcast.
  const [updated] = await db
    .update(broadcasts)
    .set({ status: "sending", updatedAt: new Date() })
    .where(
      and(
        eq(broadcasts.id, broadcast.id),
        eq(broadcasts.workspaceId, workspaceId),
        eq(broadcasts.status, "draft")
      )
    )
    .returning();

  // If nothing was updated, the broadcast was already sent/sending
  if (!updated) {
    return c.json({ error: "Broadcast already sent or in progress" }, 400);
  }

  // Enqueue the job. If Redis is unavailable, roll back to draft and return
  // the corrected state so the client doesn't show a stale "sending" status.
  const finalBroadcast = await getBroadcastQueue()
    .add("send-broadcast", { broadcastId: broadcast.id, workspaceId }, { removeOnComplete: 100 })
    .then(() => updated)
    .catch(async () => {
      const [rolled] = await getDb()
        .update(broadcasts)
        .set({ status: "draft", updatedAt: new Date() })
        .where(and(eq(broadcasts.id, broadcast.id), eq(broadcasts.workspaceId, workspaceId)))
        .returning();
      return rolled ?? updated;
    });

  return c.json(finalBroadcast);
});

app.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [broadcast] = await db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.id, c.req.param("id")), eq(broadcasts.workspaceId, workspaceId)))
    .limit(1);
  if (!broadcast) return c.json({ error: "Not found" }, 404);
  if (broadcast.status === "sending") return c.json({ error: "Cannot delete a broadcast that is currently sending" }, 400);
  await db.delete(broadcasts).where(and(eq(broadcasts.id, c.req.param("id")), eq(broadcasts.workspaceId, workspaceId)));
  return c.json({ success: true });
});

app.get("/:id/sends", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const page = Number(c.req.query("page") ?? 1);
  const pageSize = Number(c.req.query("pageSize") ?? 50);
  const status = c.req.query("status");
  const db = getDb();

  const [broadcast] = await db.select({ id: broadcasts.id })
    .from(broadcasts)
    .where(and(eq(broadcasts.id, c.req.param("id")), eq(broadcasts.workspaceId, workspaceId)))
    .limit(1);
  if (!broadcast) return c.json({ error: "Not found" }, 404);

  const conditions = [eq(emailSends.broadcastId, c.req.param("id")), eq(emailSends.workspaceId, workspaceId)];
  if (status) conditions.push(eq(emailSends.status, status));

  const [{ total }] = await db.select({ total: count() }).from(emailSends).where(and(...conditions));
  const data = await db.select().from(emailSends).where(and(...conditions))
    .orderBy(desc(emailSends.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({ data, total, page, pageSize });
});

app.get("/:id/top-links", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();

  const [broadcast] = await db.select({ id: broadcasts.id })
    .from(broadcasts)
    .where(and(eq(broadcasts.id, c.req.param("id")), eq(broadcasts.workspaceId, workspaceId)))
    .limit(1);
  if (!broadcast) return c.json({ error: "Not found" }, 404);

  const rows = await db.execute(sql`
    SELECT (ee.metadata->>'url') as url, COUNT(*)::int as clicks
    FROM email_events ee
    JOIN email_sends es ON es.id = ee.send_id
    WHERE es.broadcast_id = ${c.req.param("id")}
      AND es.workspace_id = ${workspaceId}
      AND ee.event_type = 'click'
      AND ee.metadata->>'url' IS NOT NULL
    GROUP BY url
    ORDER BY clicks DESC
    LIMIT 10
  `);

  return c.json(Array.from(rows));
});

app.post("/:id/test-send", zValidator("json", z.object({ email: z.string().email() })), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const { email } = c.req.valid("json");

  const [broadcast] = await db.select()
    .from(broadcasts)
    .where(and(eq(broadcasts.id, c.req.param("id")), eq(broadcasts.workspaceId, workspaceId)))
    .limit(1);
  if (!broadcast) return c.json({ error: "Not found" }, 404);

  const { getResend } = await import("../lib/resend.js");
  const resend = getResend();
  if (!resend) return c.json({ error: "Email sending not configured" }, 503);

  const htmlContent = broadcast.htmlContent ?? "<p>No content</p>";
  await resend.emails.send({
    from: broadcast.fromEmail ? `${broadcast.fromName ?? ""} <${broadcast.fromEmail}>`.trim() : "OpenMail <onboarding@resend.dev>",
    to: [email],
    subject: `[TEST] ${broadcast.subject}`,
    html: htmlContent,
  });

  return c.json({ success: true });
});

export default app;
