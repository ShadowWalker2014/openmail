import { Worker, Queue } from "bullmq";
import { getWorkerRedisConnection, getQueueRedisConnection } from "../lib/redis.js";
import { getDb } from "@openmail/shared/db";
import { broadcasts, contacts, emailSends } from "@openmail/shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { generateId } from "@openmail/shared/ids";
import { getSegmentContactIds } from "../lib/segment-evaluator.js";
import { chunkArray } from "../lib/email-utils.js";
import { logger } from "../lib/logger.js";
import type { SendBatchJobData } from "./send-batch.js";

export interface SendBroadcastJobData {
  broadcastId: string;
  workspaceId: string;
}

/** Max emails per Resend batch API call (hard limit: 100). */
const BATCH_SIZE = 100;

let _sendBatchQueue: Queue | null = null;
function getSendBatchQueue() {
  if (!_sendBatchQueue)
    _sendBatchQueue = new Queue("send-batch", { connection: getQueueRedisConnection() });
  return _sendBatchQueue;
}

export function createSendBroadcastWorker() {
  return new Worker<SendBroadcastJobData>(
    "broadcasts",
    async (job) => {
      const db = getDb();
      const { broadcastId, workspaceId } = job.data;

      const [broadcast] = await db
        .select()
        .from(broadcasts)
        .where(eq(broadcasts.id, broadcastId))
        .limit(1);
      if (!broadcast) throw new Error(`Broadcast ${broadcastId} not found`);

      if (!broadcast.htmlContent && !broadcast.templateId) {
        await db
          .update(broadcasts)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(broadcasts.id, broadcastId));
        throw new Error(`Broadcast ${broadcastId} has no HTML content or template`);
      }

      const segmentIds = broadcast.segmentIds as string[];
      const eligibleContactIds = await getSegmentContactIds(workspaceId, segmentIds);

      if (eligibleContactIds.length === 0) {
        await db
          .update(broadcasts)
          .set({ status: "sent", sentCount: 0, recipientCount: 0, sentAt: new Date(), updatedAt: new Date() })
          .where(eq(broadcasts.id, broadcastId));
        logger.info({ broadcastId }, "No eligible contacts for broadcast");
        return;
      }

      const eligibleContacts = await db
        .select({ id: contacts.id, email: contacts.email })
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, workspaceId),
            eq(contacts.unsubscribed, false),
            inArray(contacts.id, eligibleContactIds)
          )
        );

      // Set recipientCount upfront so the live progress bar is accurate.
      await db
        .update(broadcasts)
        .set({
          status: "sending",
          sentCount: 0,
          recipientCount: eligibleContacts.length,
          updatedAt: new Date(),
        })
        .where(eq(broadcasts.id, broadcastId));

      // ── Chunk into batches of 100 and queue one send-batch job per chunk ──
      // This is what makes bulk sending feasible at scale:
      //   - Old: 1 BullMQ job + 1 Resend API call per email (rate-limited at 2–3/s)
      //   - New: 1 BullMQ job + 1 Resend batch call per 100 emails (100× more efficient)
      const chunks = chunkArray(eligibleContacts, BATCH_SIZE);
      const sendBatchQueue = getSendBatchQueue();

      for (const chunk of chunks) {
        // Pre-assign sendIds so the IDs are known before the batch job runs.
        // This lets send-batch look up the rows by ID in one inArray query.
        const chunkSends = chunk.map((contact) => ({
          id: generateId("snd"),
          workspaceId,
          contactId: contact.id,
          contactEmail: contact.email,
          broadcastId,
          subject: broadcast.subject,
          status: "queued" as const,
        }));

        // Bulk-insert all emailSends rows for this chunk in one DB round-trip.
        await db.insert(emailSends).values(chunkSends);

        const jobData: SendBatchJobData = {
          sendIds: chunkSends.map((s) => s.id),
          broadcastId,
          workspaceId,
        };
        await sendBatchQueue.add("send-batch", jobData, { removeOnComplete: 100 });
      }

      logger.info(
        { broadcastId, recipients: eligibleContacts.length, batches: chunks.length },
        "Broadcast queued for batch sending"
      );
    },
    { connection: getWorkerRedisConnection(), concurrency: 2 }
  );
}
