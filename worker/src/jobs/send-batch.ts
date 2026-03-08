/**
 * send-batch worker
 *
 * Sends up to 100 emails in a single Resend batch API call
 * (POST /emails/batch). This replaces the one-email-per-request pattern
 * used by send-email for broadcast sends.
 *
 * Resend's single-send endpoint has a very low rate limit (2–3/sec on
 * free plans). The batch endpoint allows up to 100 emails per request at
 * a much higher throughput ceiling, making it the only viable option for
 * sending to large contact lists.
 *
 * Job flow:
 *   send-broadcast → chunks contacts into ≤100 → queues send-batch jobs
 *   send-batch     → resolves HTML, injects per-contact tracking, calls
 *                    resend.batch.send([...]) → updates emailSends rows
 *                    → increments broadcast sentCount
 */

import { Worker } from "bullmq";
import { Resend } from "resend";
import { getWorkerRedisConnection } from "../lib/redis.js";
import { getResend } from "../lib/resend.js";
import { getDb } from "@openmail/shared/db";
import {
  emailSends,
  emailTemplates,
  broadcasts,
  workspaces,
} from "@openmail/shared/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { injectTracking } from "../lib/email-utils.js";

export interface SendBatchJobData {
  /** Ordered list of emailSends IDs — max 100 per job. */
  sendIds: string[];
  broadcastId: string;
  workspaceId: string;
}

export function createSendBatchWorker() {
  return new Worker<SendBatchJobData>(
    "send-batch",
    async (job) => {
      const { sendIds, broadcastId, workspaceId } = job.data;
      const db = getDb();
      const trackerUrl = process.env.TRACKER_URL ?? "http://localhost:3002";

      if (sendIds.length === 0) return;

      // ── Fetch all sends in one query ────────────────────────────────────
      const sends = await db
        .select()
        .from(emailSends)
        .where(inArray(emailSends.id, sendIds));

      if (sends.length === 0) return;

      // Re-order to match the original sendIds order so that
      // sends[i] corresponds to batchPayload[i] and responseIds[i].
      const sendsMap = new Map(sends.map((s) => [s.id, s]));
      const orderedSends = sendIds
        .map((id) => sendsMap.get(id))
        .filter((s): s is (typeof sends)[number] => s !== undefined);

      // ── Fetch workspace once ─────────────────────────────────────────────
      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      // ── Resolve broadcast HTML content once (same for every recipient) ──
      const [broadcast] = await db
        .select()
        .from(broadcasts)
        .where(eq(broadcasts.id, broadcastId))
        .limit(1);
      if (!broadcast) throw new Error(`Broadcast ${broadcastId} not found`);

      let htmlContent = "";
      if (broadcast.templateId) {
        const [tmpl] = await db
          .select()
          .from(emailTemplates)
          .where(eq(emailTemplates.id, broadcast.templateId))
          .limit(1);
        htmlContent = tmpl?.htmlContent ?? broadcast.htmlContent ?? "";
      } else {
        htmlContent = broadcast.htmlContent ?? "";
      }
      if (!htmlContent) throw new Error(`No HTML content for broadcast ${broadcastId}`);

      const fromEmail =
        workspace.resendFromEmail ??
        process.env.DEFAULT_FROM_EMAIL ??
        "noreply@openmail.dev";
      const fromName =
        workspace.resendFromName ?? process.env.DEFAULT_FROM_NAME ?? "OpenMail";
      const from = `${fromName} <${fromEmail}>`;

      const resendClient = workspace.resendApiKey
        ? new Resend(workspace.resendApiKey)
        : getResend();

      // ── Build batch payload ─────────────────────────────────────────────
      // Each email gets its own tracking-injected HTML so open/click/unsub
      // events are correctly attributed to the individual contact.
      const batchPayload = orderedSends.map((send) => ({
        from,
        to: send.contactEmail,
        subject: broadcast.subject,
        html: injectTracking(htmlContent, send.id, trackerUrl),
      }));

      const processedCount = orderedSends.length;

      // ── Send via Resend batch API (up to 100 per call) ─────────────────
      // Always increment sentCount in the finally block so the broadcast
      // never gets stuck in "sending" due to a Resend API failure.
      try {
        const result = await resendClient.batch.send(batchPayload);

        if (result.error || !result.data) {
          const errMsg = result.error?.message ?? "Batch send failed";
          await db
            .update(emailSends)
            .set({ status: "failed", failedAt: new Date(), failureReason: errMsg })
            .where(inArray(emailSends.id, sendIds));
          logger.warn(
            { broadcastId, batchSize: processedCount, error: errMsg },
            "Resend batch send failed"
          );
        } else {
          // result.data.data is the ordered array of { id } objects.
          // data[i].id is the Resend message ID for orderedSends[i].
          const responseIds = result.data.data;
          const now = new Date();
          await db
            .update(emailSends)
            .set({ status: "sent", sentAt: now })
            .where(inArray(emailSends.id, sendIds));

          // Back-fill individual Resend message IDs where available.
          // Done as separate updates so a partial write failure here doesn't
          // fail the whole batch — the status is already correct above.
          await Promise.all(
            orderedSends.map((send, i) => {
              const resendMessageId = responseIds[i]?.id;
              if (!resendMessageId) return Promise.resolve();
              return db
                .update(emailSends)
                .set({ resendMessageId })
                .where(eq(emailSends.id, send.id));
            })
          );

          logger.info(
            { broadcastId, batchSize: processedCount },
            "Batch email sent successfully"
          );
        }
      } finally {
        // Always count the batch as processed, regardless of Resend outcome.
        // sentCount represents "processed" not "delivered" — query
        // emailSends.status = 'sent' for accurate delivery counts.
        await db
          .update(broadcasts)
          .set({
            sentCount: sql`${broadcasts.sentCount} + ${processedCount}`,
            updatedAt: new Date(),
          })
          .where(eq(broadcasts.id, broadcastId));

        // Flip broadcast status to "sent" when all recipients have been processed.
        const [bcast] = await db
          .select({ sentCount: broadcasts.sentCount, recipientCount: broadcasts.recipientCount })
          .from(broadcasts)
          .where(eq(broadcasts.id, broadcastId))
          .limit(1);

        if (
          bcast &&
          bcast.sentCount !== null &&
          bcast.recipientCount !== null &&
          bcast.sentCount >= bcast.recipientCount
        ) {
          await db
            .update(broadcasts)
            .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
            .where(eq(broadcasts.id, broadcastId));
        }
      }
    },
    { connection: getWorkerRedisConnection(), concurrency: 5 }
  );
}
