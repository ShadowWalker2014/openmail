import { Hono } from "hono";
import { getDb } from "@openmail/shared/db";
import { emailSends, emailEvents, contacts, broadcasts } from "@openmail/shared/schema";
import { eq, sql } from "drizzle-orm";
import { generateId } from "@openmail/shared/ids";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const app = new Hono();

// Deduplicate opens within a 10-second window to reduce Apple MPP inflation
const recentOpenIds = new Set<string>();

// 1x1 transparent GIF pixel
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

app.get("/health", (c) => c.json({ status: "ok", service: "tracker" }));

// Open tracking pixel: GET /t/open/:sendId
app.get("/t/open/:sendId", async (c) => {
  const { sendId } = c.req.param();
  const db = getDb();

  const [send] = await db.select().from(emailSends).where(eq(emailSends.id, sendId)).limit(1);
  if (send) {
    if (!recentOpenIds.has(sendId)) {
      recentOpenIds.add(sendId);
      setTimeout(() => recentOpenIds.delete(sendId), 10_000);
      await db.insert(emailEvents).values({
        id: generateId("eev"),
        workspaceId: send.workspaceId,
        sendId: send.id,
        contactId: send.contactId,
        eventType: "open",
        metadata: { userAgent: c.req.header("User-Agent"), ip: c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") },
      });
      // Update broadcast open count
      if (send.broadcastId) {
        await db.update(broadcasts)
          .set({ openCount: sql`${broadcasts.openCount} + 1` })
          .where(eq(broadcasts.id, send.broadcastId));
      }
    }
  }

  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
    },
  });
});

// Click tracking redirect: GET /t/click/:sendId?url=...
app.get("/t/click/:sendId", async (c) => {
  const { sendId } = c.req.param();
  const url = c.req.query("url");
  if (!url) return c.text("Missing url parameter", 400);

  const decodedUrl = decodeURIComponent(url);
  if (!decodedUrl.startsWith("http://") && !decodedUrl.startsWith("https://")) {
    return c.text("Invalid redirect URL", 400);
  }

  const db = getDb();
  const [send] = await db.select().from(emailSends).where(eq(emailSends.id, sendId)).limit(1);
  if (send) {
    await db.insert(emailEvents).values({
      id: generateId("eev"),
      workspaceId: send.workspaceId,
      sendId: send.id,
      contactId: send.contactId,
      eventType: "click",
      metadata: { url: decodedUrl, userAgent: c.req.header("User-Agent") },
    });
    if (send.broadcastId) {
      await db.update(broadcasts)
        .set({ clickCount: sql`${broadcasts.clickCount} + 1` })
        .where(eq(broadcasts.id, send.broadcastId));
    }
  }

  return c.redirect(decodedUrl, 302);
});

// Unsubscribe: GET /t/unsub/:sendId
app.get("/t/unsub/:sendId", async (c) => {
  const { sendId } = c.req.param();
  const db = getDb();

  const [send] = await db.select().from(emailSends).where(eq(emailSends.id, sendId)).limit(1);
  if (send?.contactId) {
    await db.update(contacts).set({ unsubscribed: true, unsubscribedAt: new Date() }).where(eq(contacts.id, send.contactId));
    await db.insert(emailEvents).values({
      id: generateId("eev"),
      workspaceId: send.workspaceId,
      sendId: send.id,
      contactId: send.contactId,
      eventType: "unsubscribe",
      metadata: {},
    });
    logger.info({ sendId, contactId: send.contactId }, "Contact unsubscribed");
  }

  const webUrl = process.env.WEB_URL ?? "";
  return c.redirect(`${webUrl}/unsubscribe`, 302);
});

const port = Number(process.env.PORT ?? 3003);
logger.info({ port }, "Tracker server starting");

export default { port, fetch: app.fetch };
