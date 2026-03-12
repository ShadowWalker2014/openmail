import { Worker, Queue } from "bullmq";
import { getWorkerRedisConnection, getQueueRedisConnection } from "../lib/redis.js";
import { getDb } from "@openmail/shared/db";
import { broadcasts, emailSends } from "@openmail/shared/schema";
import { eq } from "drizzle-orm";
import { generateId } from "@openmail/shared/ids";
import { getSegmentContacts } from "../lib/segment-evaluator.js";
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

      // ── SQL-native segment evaluation ────────────────────────────────────
      // getSegmentContacts runs a single UNION SQL query in PostgreSQL.
      // No contacts, events, or group memberships are loaded into Node.js
      // memory — the DB evaluates all conditions natively with index support.
      // Returns only the two fields needed: { id, email }.
      const eligibleContacts = await getSegmentContacts(workspaceId, segmentIds);

      if (eligibleContacts.length === 0) {
        await db
          .update(broadcasts)
          .set({ status: "sent", sentCount: 0, recipientCount: 0, sentAt: new Date(), updatedAt: new Date() })
          .where(eq(broadcasts.id, broadcastId));
        logger.info({ broadcastId }, "No eligible contacts for broadcast");
        return;
      }

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
      const chunks = chunkArray(eligibleContacts, BATCH_SIZE);
      const sendBatchQueue = getSendBatchQueue();

      for (const chunk of chunks) {
        const chunkSends = chunk.map((contact) => ({
          id:           generateId("snd"),
          workspaceId,
          contactId:    contact.id,
          contactEmail: contact.email,
          broadcastId,
          subject:      broadcast.subject,
          status:       "queued" as const,
        }));

        // Bulk-insert all emailSends rows for this chunk in one DB round-trip.
        await db.insert(emailSends).values(chunkSends);

        const jobData: SendBatchJobData = {
          sendIds: chunkSends.map((s) => s.id),
          broadcastId,
          workspaceId,
        };
        await sendBatchQueue.add("send-batch", jobData, {
          removeOnComplete: 100,
          attempts: 5,
          backoff: { type: "exponential", delay: 10_000 },
        });
      }

      logger.info(
        { broadcastId, recipients: eligibleContacts.length, batches: chunks.length },
        "Broadcast queued for batch sending"
      );
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: 2,
      removeOnFail: { count: 50 },
    },
  );
}
