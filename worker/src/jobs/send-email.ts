import { Worker } from "bullmq";
import { Resend } from "resend";
import { getWorkerRedisConnection } from "../lib/redis.js";
import { getResend } from "../lib/resend.js";
import { getDb } from "@openmail/shared/db";
import { emailSends, emailTemplates, broadcasts, campaignSteps, workspaces } from "@openmail/shared/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { injectTracking } from "../lib/email-utils.js";

export interface SendEmailJobData {
  sendId: string;
  /** Passed from send-broadcast so we can update sentCount without an extra query */
  broadcastId?: string;
}

/**
 * Return true for transient Resend errors that should be retried.
 * On 429 / 5xx: BullMQ will back off and retry. On 4xx (bad email
 * address, auth failure, etc.) we mark the email as permanently failed.
 */
function isTransientResendError(
  error: { name?: string; message?: string; statusCode?: number } | null | undefined,
): boolean {
  if (!error) return false;
  const { statusCode, name = "", message = "" } = error;
  return (
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    name === "rate_limit_exceeded" ||
    name === "RateLimitExceeded" ||
    message.toLowerCase().includes("rate limit") ||
    message.toLowerCase().includes("too many requests")
  );
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

      // Track send outcome for post-finally logic.
      // transientError: set when Resend returns 429/5xx — job will be retried,
      // sentCount must NOT be incremented until the eventual success attempt.
      let sendSuccess = false;
      let transientError: Error | null = null;

      try {
        const result = await resendClient.emails.send({
          from: `${fromName} <${fromEmail}>`,
          to: send.contactEmail,
          subject,
          html: trackedHtml,
        });

        if (result.error) {
          if (isTransientResendError(result.error)) {
            // Transient (rate limit / server error) — do NOT mark failed yet,
            // do NOT advance sentCount. Throw after the finally block so BullMQ
            // retries with exponential backoff.
            transientError = new Error(
              `Resend transient error (will retry): ${result.error.message}`,
            );
            logger.warn(
              { sendId, error: result.error.message },
              "Transient Resend error — job will be retried",
            );
          } else {
            // Permanent failure (bad address, auth, etc.) — record immediately.
            await db.update(emailSends).set({
              status: "failed",
              failedAt: new Date(),
              failureReason: result.error.message,
            }).where(eq(emailSends.id, sendId));
            logger.warn({ sendId, error: result.error.message }, "Email send failed (permanent)");
          }
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
        // Advance broadcast sentCount only when definitively processed (success or
        // permanent failure). Skip on transient errors — the job will be retried
        // and the count will be advanced when it eventually succeeds or permanently fails.
        if (effectiveBroadcastId && !transientError) {
          await db.update(broadcasts).set({
            sentCount: sql`${broadcasts.sentCount} + 1`,
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

      // Re-throw transient errors AFTER the finally block so BullMQ retries
      // with backoff. (The finally block was a no-op for transient errors.)
      if (transientError) throw transientError;

      // Broadcast email failures: sentCount already incremented in finally —
      // don't retry (would double-count) and don't throw.
      if (!sendSuccess && send.broadcastId) return;

      // Campaign email failures: throw so BullMQ marks the job FAILED (not
      // COMPLETED) and applies retry logic.
      if (!sendSuccess && !send.broadcastId) {
        throw new Error(send.failureReason ?? "Send failed");
      }
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: 10,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    }
  );
}
