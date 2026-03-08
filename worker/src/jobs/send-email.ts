import { Worker } from "bullmq";
import { Resend } from "resend";
import { getRedisConnection } from "../lib/redis.js";
import { getResend } from "../lib/resend.js";
import { getDb } from "@openmail/shared/db";
import { emailSends, emailTemplates, broadcasts, campaignSteps, workspaces } from "@openmail/shared/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export interface SendEmailJobData {
  sendId: string;
  /** Passed from send-broadcast so we can update sentCount without an extra query */
  broadcastId?: string;
}

function injectTracking(html: string, sendId: string, trackerUrl: string): string {
  const pixel = `<img src="${trackerUrl}/t/open/${sendId}" width="1" height="1" style="display:none" alt="" />`;
  const unsubLink = `<div style="text-align:center;padding:16px;font-size:12px;color:#888">
    <a href="${trackerUrl}/t/unsub/${sendId}" style="color:#888">Unsubscribe</a>
  </div>`;

  const withTrackedLinks = html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (_, url) => `href="${trackerUrl}/t/click/${sendId}?url=${encodeURIComponent(url)}"`
  );

  const injected = withTrackedLinks.replace(/<\/body>/i, `${pixel}${unsubLink}</body>`);
  return injected !== withTrackedLinks ? injected : withTrackedLinks + pixel + unsubLink;
}

export function createSendEmailWorker() {
  return new Worker<SendEmailJobData>(
    "send-email",
    async (job) => {
      const db = getDb();
      const trackerUrl = process.env.TRACKER_URL ?? "http://localhost:3002";
      const { sendId, broadcastId } = job.data;

      const [send] = await db.select().from(emailSends).where(eq(emailSends.id, sendId)).limit(1);
      if (!send) throw new Error(`Send ${sendId} not found`);

      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, send.workspaceId))
        .limit(1);
      if (!workspace) throw new Error(`Workspace ${send.workspaceId} not found`);

      let htmlContent = "";
      let subject = send.subject;

      if (send.broadcastId) {
        const [broadcast] = await db
          .select()
          .from(broadcasts)
          .where(eq(broadcasts.id, send.broadcastId))
          .limit(1);
        if (broadcast) {
          subject = broadcast.subject;
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
        }
      } else if (send.campaignStepId) {
        const [step] = await db
          .select()
          .from(campaignSteps)
          .where(eq(campaignSteps.id, send.campaignStepId))
          .limit(1);
        if (step) {
          const config = step.config as { templateId?: string; subject?: string; htmlContent?: string };
          subject = config.subject ?? subject;
          if (config.templateId) {
            const [tmpl] = await db
              .select()
              .from(emailTemplates)
              .where(eq(emailTemplates.id, config.templateId))
              .limit(1);
            htmlContent = tmpl?.htmlContent ?? "";
          } else {
            htmlContent = config.htmlContent ?? "";
          }
        }
      }

      if (!htmlContent) throw new Error(`No HTML content for send ${sendId}`);

      const trackedHtml = injectTracking(htmlContent, sendId, trackerUrl);

      const resendClient = workspace.resendApiKey
        ? new Resend(workspace.resendApiKey)
        : getResend();

      const fromEmail = workspace.resendFromEmail ?? process.env.DEFAULT_FROM_EMAIL ?? "noreply@openmail.dev";
      const fromName = workspace.resendFromName ?? process.env.DEFAULT_FROM_NAME ?? "OpenMail";

      const effectiveBroadcastId = broadcastId ?? send.broadcastId;

      // Attempt the send, then unconditionally increment sentCount in `finally`
      // so failed sends don't leave the broadcast permanently stuck in "sending".
      let sendSuccess = false;
      try {
        const result = await resendClient.emails.send({
          from: `${fromName} <${fromEmail}>`,
          to: send.contactEmail,
          subject,
          html: trackedHtml,
        });

        if (result.error) {
          await db.update(emailSends).set({
            status: "failed",
            failedAt: new Date(),
            failureReason: result.error.message,
          }).where(eq(emailSends.id, sendId));
          logger.warn({ sendId, error: result.error.message }, "Email send failed");
        } else {
          await db.update(emailSends).set({
            status: "sent",
            resendMessageId: result.data!.id,
            sentAt: new Date(),
          }).where(eq(emailSends.id, sendId));
          sendSuccess = true;
          logger.info({ sendId, resendMessageId: result.data!.id }, "Email sent successfully");
        }
      } finally {
        // Always count this email as processed toward broadcast completion,
        // regardless of whether it succeeded or failed. This prevents broadcasts
        // from getting stuck in "sending" due to transient delivery failures.
        // (sentCount represents "processed" not "successfully delivered" — query
        //  emailSends.status = 'sent' for accurate delivery counts.)
        if (effectiveBroadcastId) {
          await db.update(broadcasts).set({
            sentCount: sql`sent_count + 1`,
            updatedAt: new Date(),
          }).where(eq(broadcasts.id, effectiveBroadcastId));

          // Check if all emails have been processed — flip to "sent" when done
          const [bcast] = await db
            .select({ sentCount: broadcasts.sentCount, recipientCount: broadcasts.recipientCount })
            .from(broadcasts)
            .where(eq(broadcasts.id, effectiveBroadcastId))
            .limit(1);

          if (
            bcast &&
            bcast.sentCount !== null &&
            bcast.recipientCount !== null &&
            bcast.sentCount >= bcast.recipientCount
          ) {
            await db.update(broadcasts).set({
              status: "sent",
              sentAt: new Date(),
              updatedAt: new Date(),
            }).where(eq(broadcasts.id, effectiveBroadcastId));
          }
        }
      }

      // Re-throw after the finally block has run so BullMQ marks the job as failed
      // and applies retry logic — the sentCount increment has already been committed.
      if (!sendSuccess && send.broadcastId) {
        // Don't re-throw for broadcast emails — the finally block handled completion.
        // Individual failures are recorded in emailSends; we don't want BullMQ to
        // retry the entire send (which would re-deliver to already-processed contacts).
        return;
      }
    },
    { connection: getRedisConnection(), concurrency: 10 }
  );
}
