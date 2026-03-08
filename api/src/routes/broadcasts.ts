import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { broadcasts } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and } from "drizzle-orm";
import { Queue } from "bullmq";
import { getRedisConnection } from "../lib/redis.js";
import type { ApiVariables } from "../types.js";

let _broadcastQueue: Queue | null = null;
function getBroadcastQueue() {
  if (!_broadcastQueue) _broadcastQueue = new Queue("broadcasts", { connection: getRedisConnection() });
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
  if (broadcast.status !== "draft") return c.json({ error: "Broadcast already sent or in progress" }, 400);

  const [updated] = await db
    .update(broadcasts)
    .set({ status: "sending", updatedAt: new Date() })
    .where(and(eq(broadcasts.id, broadcast.id), eq(broadcasts.workspaceId, workspaceId)))
    .returning();

  // If Redis is unavailable, reset to draft so the user can retry
  await getBroadcastQueue()
    .add("send-broadcast", { broadcastId: broadcast.id, workspaceId }, { removeOnComplete: 100 })
    .catch(async () => {
      await getDb()
        .update(broadcasts)
        .set({ status: "draft", updatedAt: new Date() })
        .where(and(eq(broadcasts.id, broadcast.id), eq(broadcasts.workspaceId, workspaceId)));
    });
  return c.json(updated);
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

export default app;
