import { Hono } from "hono";
import { getDb } from "@openmail/shared/db";
import { emailSends, emailEvents, broadcasts, contacts } from "@openmail/shared/schema";
import { eq, and, gte, count } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

app.get("/overview", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalContacts] = await db
    .select({ count: count() })
    .from(contacts)
    .where(eq(contacts.workspaceId, workspaceId));

  const [totalSends] = await db
    .select({ count: count() })
    .from(emailSends)
    .where(and(eq(emailSends.workspaceId, workspaceId), gte(emailSends.createdAt, since)));

  const [opens] = await db
    .select({ count: count() })
    .from(emailEvents)
    .where(and(eq(emailEvents.workspaceId, workspaceId), eq(emailEvents.eventType, "open"), gte(emailEvents.occurredAt, since)));

  const [clicks] = await db
    .select({ count: count() })
    .from(emailEvents)
    .where(and(eq(emailEvents.workspaceId, workspaceId), eq(emailEvents.eventType, "click"), gte(emailEvents.occurredAt, since)));

  const [unsubscribes] = await db
    .select({ count: count() })
    .from(emailEvents)
    .where(and(eq(emailEvents.workspaceId, workspaceId), eq(emailEvents.eventType, "unsubscribe"), gte(emailEvents.occurredAt, since)));

  const [bounces] = await db
    .select({ count: count() })
    .from(emailEvents)
    .where(and(eq(emailEvents.workspaceId, workspaceId), eq(emailEvents.eventType, "bounce"), gte(emailEvents.occurredAt, since)));

  const [complaints] = await db
    .select({ count: count() })
    .from(emailEvents)
    .where(and(eq(emailEvents.workspaceId, workspaceId), eq(emailEvents.eventType, "complaint"), gte(emailEvents.occurredAt, since)));

  const totalSendsCount = totalSends.count;
  return c.json({
    contacts: totalContacts.count,
    sends: totalSendsCount,
    opens: opens.count,
    clicks: clicks.count,
    unsubscribes: unsubscribes.count,
    bounces: bounces.count,
    complaints: complaints.count,
    openRate:       totalSendsCount > 0 ? Number((opens.count      / totalSendsCount * 100).toFixed(1)) : 0,
    clickRate:      totalSendsCount > 0 ? Number((clicks.count     / totalSendsCount * 100).toFixed(1)) : 0,
    bounceRate:     totalSendsCount > 0 ? Number((bounces.count    / totalSendsCount * 100).toFixed(1)) : 0,
    complaintRate:  totalSendsCount > 0 ? Number((complaints.count / totalSendsCount * 100).toFixed(1)) : 0,
    period: "30d",
  });
});

app.get("/broadcasts/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const broadcastId = c.req.param("id");
  const db = getDb();

  const [bcast] = await db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.workspaceId, workspaceId)))
    .limit(1);

  if (!bcast) return c.json({ error: "Not found" }, 404);

  const eventCounts = await db
    .select({ eventType: emailEvents.eventType, count: count() })
    .from(emailEvents)
    .innerJoin(emailSends, eq(emailEvents.sendId, emailSends.id))
    .where(and(eq(emailEvents.workspaceId, workspaceId), eq(emailSends.broadcastId, broadcastId)))
    .groupBy(emailEvents.eventType);

  const stats = Object.fromEntries(eventCounts.map((e) => [e.eventType, e.count]));
  const sentCount = bcast.sentCount ?? 0;
  return c.json({
    broadcastId,
    sentCount,
    openCount:      bcast.openCount,
    clickCount:     bcast.clickCount,
    bounceCount:    bcast.bounceCount,
    complaintCount: bcast.complaintCount,
    openRate:       sentCount > 0 ? Number(((bcast.openCount      ?? 0) / sentCount * 100).toFixed(1)) : 0,
    clickRate:      sentCount > 0 ? Number(((bcast.clickCount     ?? 0) / sentCount * 100).toFixed(1)) : 0,
    bounceRate:     sentCount > 0 ? Number(((bcast.bounceCount    ?? 0) / sentCount * 100).toFixed(1)) : 0,
    complaintRate:  sentCount > 0 ? Number(((bcast.complaintCount ?? 0) / sentCount * 100).toFixed(1)) : 0,
    ...stats,
  });
});

export default app;
