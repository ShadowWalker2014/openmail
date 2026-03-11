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
 *
 * Rate limiting:
 *   The worker's BullMQ limiter caps throughput at BATCH_RATE_PER_SEC
 *   batches/second (= BATCH_RATE_PER_SEC × 100 emails/second) so we
 *   stay well within Resend's batch API rate limit on any plan tier.
 *   Jobs are retried with exponential backoff on transient errors (429,
 *   5xx) so a temporary rate-limit spike never permanently loses emails.
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

/**
 * Resend batch API rate limit — how many batch jobs (each = 100 emails)
 * this worker processes per second across all instances.
 *
 * Resend's batch endpoint limits (approx):
 *   Free plan:       ~1  req/s →   100 emails/s
 *   Pro  ($20/mo):  ~10  req/s → 1,000 emails/s   ← default
 *   Business:       ~30  req/s → 3,000 emails/s
 *   Enterprise:     higher — contact Resend
 *
 * Override with RESEND_BATCH_RATE_PER_SEC env var.
 * Example: RESEND_BATCH_RATE_PER_SEC=30 for Business plan.
 *
 * At 10 req/s: 100k emails ≈ 1,000 batches ÷ 10 = ~100s (~2 min).
 * At 30 req/s: 100k emails ≈ 1,000 batches ÷ 30 = ~33s  (< 1 min).
 */
const BATCH_RATE_PER_SEC = Number(process.env.RESEND_BATCH_RATE_PER_SEC ?? 10);

/**
 * Return true for transient Resend errors that should be retried.
 * On 429 / 5xx: BullMQ will back off and retry. On 4xx (bad email
 * address, auth failure, etc.) we mark the emails as permanently failed.
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

      const processedCount = orderedSends.length;

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
        to:      send.contactEmail,
        subject: broadcast.subject,
        html:    injectTracking(htmlContent, send.id, trackerUrl),
      }));

      // ── Send via Resend batch API ────────────────────────────────────────
      // CRITICAL: distinguish transient errors (429, 5xx) from permanent
      // failures (4xx). On transient errors we MUST NOT mark emails failed
      // and MUST NOT advance sentCount — BullMQ will retry with backoff and
      // the same sendIds will be re-sent on the next attempt.
      let transientError: Error | null = null;

      try {
        const result = await resendClient.batch.send(batchPayload);

        if (result.error || !result.data) {
          const errMsg = result.error?.message ?? "Batch send failed";

          if (isTransientResendError(result.error)) {
            // Transient — do NOT mark emails failed, do NOT advance sentCount.
            // Throw so BullMQ retries this job with exponential backoff.
            transientError = new Error(`Resend transient error (will retry): ${errMsg}`);
            logger.warn(
              { broadcastId, batchSize: processedCount, error: errMsg },
              "Transient Resend error — job will be retried"
            );
          } else {
            // Permanent error (invalid address, auth failure, etc.) — mark failed.
            await db
              .update(emailSends)
              .set({ status: "failed", failedAt: new Date(), failureReason: errMsg })
              .where(inArray(emailSends.id, sendIds));
            logger.warn(
              { broadcastId, batchSize: processedCount, error: errMsg },
              "Permanent Resend error — emails marked failed"
            );
          }
        } else {
          // ── Success: mark all sends as sent ──────────────────────────────
          await db
            .update(emailSends)
            .set({ status: "sent", sentAt: new Date() })
            .where(inArray(emailSends.id, sendIds));

          // Back-fill Resend message IDs in a single bulk UPDATE using unnest.
          // Replaces the previous pattern of N individual UPDATE queries.
          const responseIds = result.data.data ?? [];
          const pairs = orderedSends
            .map((send, i) => ({ id: send.id, msgId: responseIds[i]?.id }))
            .filter((p): p is { id: string; msgId: string } => !!p.msgId);

          if (pairs.length > 0) {
            await db.execute(sql`
              UPDATE email_sends
              SET resend_message_id = vals.msg_id
              FROM unnest(
                ARRAY[${sql.join(pairs.map((p) => sql`${p.id}`), sql`, `)}]::text[],
                ARRAY[${sql.join(pairs.map((p) => sql`${p.msgId}`), sql`, `)}]::text[]
              ) AS vals(sid, msg_id)
              WHERE email_sends.id = vals.sid
            `);
          }

          logger.info(
            { broadcastId, batchSize: processedCount },
            "Batch email sent successfully"
          );
        }
      } finally {
        // Only advance sentCount when the batch has been definitively processed
        // (success OR permanent failure). Skip on transient errors — the job
        // will be retried and these emails counted when they eventually succeed.
        if (!transientError) {
          await db
            .update(broadcasts)
            .set({
              sentCount: sql`${broadcasts.sentCount} + ${processedCount}`,
              updatedAt: new Date(),
            })
            .where(eq(broadcasts.id, broadcastId));

          // Flip broadcast status to "sent" when all recipients are processed.
          // Use a single UPDATE with a WHERE condition to avoid a read-then-write.
          await db
            .update(broadcasts)
            .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
            .where(
              sql`${broadcasts.id} = ${broadcastId}
                AND ${broadcasts.sentCount} >= ${broadcasts.recipientCount}
                AND ${broadcasts.status} = 'sending'`
            );
        }
      }

      // Re-throw transient errors AFTER the finally block so BullMQ sees a
      // failed job and applies retry/backoff. (The finally block is a no-op
      // for transient errors, so no sentCount was advanced.)
      if (transientError) throw transientError;
    },
    {
      connection: getWorkerRedisConnection(),
      // concurrency: how many jobs can run in parallel within one worker process.
      // Combined with the limiter below this caps peak throughput safely.
      concurrency: 10,
      // Rate limiter: at most BATCH_RATE_PER_SEC jobs processed per second
      // across ALL worker instances (BullMQ coordinates via Redis).
      // 2 batches/s × 100 emails/batch = 200 emails/second — well within
      // Resend's batch endpoint limits on any paid plan.
      limiter: {
        max:      BATCH_RATE_PER_SEC,
        duration: 1000, // ms
      },
    }
  );
}
