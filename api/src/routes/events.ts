import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { events, contacts } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and, count, desc, ilike } from "drizzle-orm";
import { Queue } from "bullmq";
import { getQueueRedisConnection } from "../lib/redis.js";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

let _eventQueue: Queue | null = null;
function getEventQueue() {
  if (!_eventQueue) _eventQueue = new Queue("events", { connection: getQueueRedisConnection() });
  return _eventQueue;
}

function parsePagination(pageStr?: string, pageSizeStr?: string) {
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(pageSizeStr ?? "50", 10) || 50));
  return { page, pageSize };
}

// ── GET / — list events for the workspace ─────────────────────────────────────
app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { page, pageSize } = parsePagination(c.req.query("page"), c.req.query("pageSize"));
  const nameFilter = c.req.query("name");
  const emailFilter = c.req.query("email");
  const db = getDb();

  const conditions = [eq(events.workspaceId, workspaceId)];
  if (nameFilter) conditions.push(ilike(events.name, `%${nameFilter}%`));
  if (emailFilter) conditions.push(ilike(events.contactEmail as any, `%${emailFilter}%`));

  const [{ total }] = await db
    .select({ total: count() })
    .from(events)
    .where(and(...conditions));

  const data = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.occurredAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({ data, total, page, pageSize });
});

// ── POST /track — track a single event (native format) ────────────────────────
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
