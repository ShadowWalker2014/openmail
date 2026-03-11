/**
 * POST /api/webhooks/resend
 *
 * Receives email delivery events from Resend (via Svix) and updates:
 *   - emailSends: status → bounced / failed
 *   - emailEvents: inserts a "bounce" or "complaint" row
 *   - contacts: marks unsubscribed = true
 *   - broadcasts: increments bounceCount / complaintCount
 *
 * Authentication: Svix signature verification (RESEND_WEBHOOK_SECRET).
 * This route is PUBLIC — no session/API-key auth, Svix handles it.
 */

import { Hono } from "hono";
import { Webhook } from "svix";
import { getDb } from "@openmail/shared/db";
import { emailSends, emailEvents, contacts, broadcasts } from "@openmail/shared/schema";
import { eq, sql } from "drizzle-orm";
import { generateId } from "@openmail/shared/ids";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const app = new Hono();

// Return 401 on bad Svix signature (not 500) so Resend doesn't retry.
// A valid Resend delivery always has a valid signature — 401 = attacker probe.
app.onError((err, c) => {
  if (err.name === "WebhookVerificationError" || err.message?.toLowerCase().includes("signature")) {
    logger.warn({ err: err.message }, "Invalid Resend webhook signature");
    return c.json({ error: "Invalid signature" }, 401);
  }
  logger.error({ err: err.message }, "Webhook handler error");
  return c.json({ error: "Internal server error" }, 500);
});

// ── Types ──────────────────────────────────────────────────────────────────

interface ResendWebhookData {
  email_id: string;
  broadcast_id?: string;
  created_at: string;
  from: string;
  to: string[];
  subject: string;
  bounce?: {
    message: string;
    subType?: string;
    type?: string;
  };
}

interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: ResendWebhookData;
}

// ── Handler ────────────────────────────────────────────────────────────────

app.post("/", async (c) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    logger.error("RESEND_WEBHOOK_SECRET is not configured — webhook disabled");
    return c.json({ error: "Webhook not configured" }, 503);
  }

  // Read raw body — MUST use raw string for Svix signature verification.
  // Re-stringifying parsed JSON would break HMAC verification.
  const rawBody = await c.req.text();

  const svixHeaders = {
    "svix-id":        c.req.header("svix-id")        ?? "",
    "svix-timestamp": c.req.header("svix-timestamp")  ?? "",
    "svix-signature": c.req.header("svix-signature")  ?? "",
  };

  // Verify Svix signature — throws WebhookVerificationError on failure.
  // onError above converts that to a clean 401.
  let payload: ResendWebhookPayload;
  const wh = new Webhook(secret);
  const verified = wh.verify(rawBody, svixHeaders);
  payload = verified as unknown as ResendWebhookPayload;

  const { type, data } = payload;
  logger.info({ type, emailId: data.email_id }, "Resend webhook received");

  if (type !== "email.bounced" && type !== "email.complained") {
    // Accept but ignore events we don't process (e.g. email.opened via Resend)
    return c.json({ ok: true });
  }

  const db = getDb();

  // Look up the emailSends row by resendMessageId
  const [send] = await db
    .select()
    .from(emailSends)
    .where(eq(emailSends.resendMessageId, data.email_id))
    .limit(1);

  if (!send) {
    // Resend may deliver webhook before we've backfilled resendMessageId (race).
    // Return 200 so Resend doesn't retry — the event is lost in this edge case,
    // but it's extremely unlikely and acceptable.
    logger.warn({ emailId: data.email_id, type }, "emailSend not found for webhook — skipping");
    return c.json({ ok: true });
  }

  const workspaceId = send.workspaceId;
  const now = new Date();

  if (type === "email.bounced") {
    const bounceMsg = data.bounce?.message ?? "Bounced";
    const bounceType = data.bounce?.type ?? "Permanent";

    await db
      .update(emailSends)
      .set({ status: "bounced", failedAt: now, failureReason: `${bounceType}: ${bounceMsg}` })
      .where(eq(emailSends.id, send.id));

    await db.insert(emailEvents).values({
      id:          generateId("eev"),
      workspaceId,
      sendId:      send.id,
      contactId:   send.contactId,
      eventType:   "bounce",
      metadata:    { bounceType, message: bounceMsg, subType: data.bounce?.subType },
    });

    // Permanent bounces = hard bounce → unsubscribe contact to prevent future sends
    if (send.contactId) {
      await db
        .update(contacts)
        .set({ unsubscribed: true, unsubscribedAt: now })
        .where(eq(contacts.id, send.contactId));
    }

    if (send.broadcastId) {
      await db
        .update(broadcasts)
        .set({ bounceCount: sql`${broadcasts.bounceCount} + 1`, updatedAt: now })
        .where(eq(broadcasts.id, send.broadcastId));
    }

    logger.info({ sendId: send.id, contactId: send.contactId, bounceType }, "Bounce recorded");

  } else if (type === "email.complained") {
    await db
      .update(emailSends)
      .set({ status: "failed", failedAt: now, failureReason: "Spam complaint" })
      .where(eq(emailSends.id, send.id));

    await db.insert(emailEvents).values({
      id:          generateId("eev"),
      workspaceId,
      sendId:      send.id,
      contactId:   send.contactId,
      eventType:   "complaint",
      metadata:    {},
    });

    // Spam complaint → always unsubscribe to protect sender reputation
    if (send.contactId) {
      await db
        .update(contacts)
        .set({ unsubscribed: true, unsubscribedAt: now })
        .where(eq(contacts.id, send.contactId));
    }

    if (send.broadcastId) {
      await db
        .update(broadcasts)
        .set({ complaintCount: sql`${broadcasts.complaintCount} + 1`, updatedAt: now })
        .where(eq(broadcasts.id, send.broadcastId));
    }

    logger.info({ sendId: send.id, contactId: send.contactId }, "Spam complaint recorded");
  }

  return c.json({ ok: true });
});

export const webhooksRouter = app;
