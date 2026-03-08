import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { events, contacts } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and } from "drizzle-orm";
import { Queue } from "bullmq";
import { getQueueRedisConnection } from "../lib/redis.js";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

let _eventQueue: Queue | null = null;
function getEventQueue() {
  if (!_eventQueue) _eventQueue = new Queue("events", { connection: getQueueRedisConnection() });
  return _eventQueue;
}

app.post(
  "/track",
  zValidator("json", z.object({
    email: z.string().email(),
    name: z.string().min(1),
    properties: z.record(z.unknown()).optional(),
    occurredAt: z.string().datetime().optional(),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const { email, name, properties, occurredAt } = c.req.valid("json");
    const db = getDb();

    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, email)))
      .limit(1);

    const id = generateId("evt");
    await db.insert(events).values({
      id,
      workspaceId,
      contactId: contact?.id ?? null,
      contactEmail: email,
      name,
      properties: properties ?? {},
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
    });

    await getEventQueue().add("process-event", { eventId: id, workspaceId }, { removeOnComplete: 100 });

    return c.json({ id }, 201);
  }
);

export default app;
