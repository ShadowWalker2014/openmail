import { Worker, Queue } from "bullmq";
import { getRedisConnection } from "../lib/redis.js";
import { getDb } from "@openmail/shared/db";
import { broadcasts, contacts, emailSends } from "@openmail/shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { generateId } from "@openmail/shared/ids";
import { getSegmentContactIds } from "../lib/segment-evaluator.js";
import { logger } from "../lib/logger.js";

export interface SendBroadcastJobData {
  broadcastId: string;
  workspaceId: string;
}

let _sendEmailQueue: Queue | null = null;
function getSendEmailQueue() {
  if (!_sendEmailQueue) _sendEmailQueue = new Queue("send-email", { connection: getRedisConnection() });
  return _sendEmailQueue;
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

      // Ensure broadcast has sendable content before burning through contacts
      if (!broadcast.htmlContent && !broadcast.templateId) {
        await db.update(broadcasts).set({
          status: "failed",
          updatedAt: new Date(),
        }).where(eq(broadcasts.id, broadcastId));
        throw new Error(`Broadcast ${broadcastId} has no HTML content or template`);
      }

      const segmentIds = broadcast.segmentIds as string[];
      const eligibleContactIds = await getSegmentContactIds(workspaceId, segmentIds);

      if (eligibleContactIds.length === 0) {
        await db.update(broadcasts).set({
          status: "sent",
          sentCount: 0,
          recipientCount: 0,
          sentAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(broadcasts.id, broadcastId));
        logger.info({ broadcastId }, "No eligible contacts for broadcast");
        return;
      }

      const eligibleContacts = await db
        .select({ id: contacts.id, email: contacts.email })
        .from(contacts)
        .where(and(
          eq(contacts.workspaceId, workspaceId),
          eq(contacts.unsubscribed, false),
          inArray(contacts.id, eligibleContactIds)
        ));

      // Set recipientCount and status to "sending" upfront so the live
      // progress bar is accurate from the start. sentCount starts at 0
      // and is incremented atomically by each send-email job.
      await db.update(broadcasts).set({
        status: "sending",
        sentCount: 0,
        recipientCount: eligibleContacts.length,
        updatedAt: new Date(),
      }).where(eq(broadcasts.id, broadcastId));

      const sendQueue = getSendEmailQueue();

      for (const contact of eligibleContacts) {
        const sendId = generateId("snd");
        await db.insert(emailSends).values({
          id: sendId,
          workspaceId,
          contactId: contact.id,
          contactEmail: contact.email,
          broadcastId,
          subject: broadcast.subject,
          status: "queued",
        });
        await sendQueue.add("send-email", { sendId, broadcastId }, { removeOnComplete: 100 });
      }

      logger.info({ broadcastId, count: eligibleContacts.length }, "Broadcast queued for sending");
      // Status transitions to "sent" are handled by send-email jobs
      // (each one increments sentCount; the last one flips status to "sent")
    },
    { connection: getRedisConnection(), concurrency: 2 }
  );
}
