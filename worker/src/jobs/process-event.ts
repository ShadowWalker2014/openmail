import { Worker, Queue } from "bullmq";
import { getRedisConnection } from "../lib/redis.js";
import { getDb } from "@openmail/shared/db";
import { events, campaigns, campaignEnrollments, campaignSteps, contacts, emailSends } from "@openmail/shared/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "@openmail/shared/ids";
import { logger } from "../lib/logger.js";

export interface ProcessEventJobData {
  eventId: string;
  workspaceId: string;
}

let _sendEmailQueue: Queue | null = null;
function getSendEmailQueue() {
  if (!_sendEmailQueue) _sendEmailQueue = new Queue("send-email", { connection: getRedisConnection() });
  return _sendEmailQueue;
}

export function createProcessEventWorker() {
  return new Worker<ProcessEventJobData>(
    "events",
    async (job) => {
      const db = getDb();
      const { eventId, workspaceId } = job.data;

      const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
      if (!event || !event.contactId) return;

      const triggeredCampaigns = await db
        .select()
        .from(campaigns)
        .where(and(
          eq(campaigns.workspaceId, workspaceId),
          eq(campaigns.status, "active"),
          eq(campaigns.triggerType, "event")
        ));

      for (const campaign of triggeredCampaigns) {
        const config = campaign.triggerConfig as { eventName?: string };
        if (config.eventName !== event.name) continue;

        const [existing] = await db
          .select()
          .from(campaignEnrollments)
          .where(and(
            eq(campaignEnrollments.campaignId, campaign.id),
            eq(campaignEnrollments.contactId, event.contactId)
          ))
          .limit(1);

        if (existing && existing.status === "active") {
          logger.info({ campaignId: campaign.id, contactId: event.contactId }, "Already enrolled, skipping");
          continue;
        }

        const steps = await db
          .select()
          .from(campaignSteps)
          .where(eq(campaignSteps.campaignId, campaign.id))
          .orderBy(campaignSteps.position);

        if (steps.length === 0) {
          logger.warn({ campaignId: campaign.id }, "Campaign has no steps, skipping enrollment");
          continue;
        }

        const firstStep = steps[0];
        const enrollmentId = generateId("enr");

        await db.insert(campaignEnrollments).values({
          id: enrollmentId,
          campaignId: campaign.id,
          workspaceId,
          contactId: event.contactId,
          currentStepId: firstStep.id,
          status: "active",
        }).onConflictDoUpdate({
          target: [campaignEnrollments.campaignId, campaignEnrollments.contactId],
          set: { status: "active", currentStepId: firstStep.id, startedAt: new Date(), completedAt: null, updatedAt: new Date() },
        });

        if (firstStep.stepType === "send_email") {
          const stepConfig = firstStep.config as { templateId?: string; subject?: string };
          const [contact] = await db.select().from(contacts).where(eq(contacts.id, event.contactId)).limit(1);
          if (contact && !contact.unsubscribed) {
            const sendId = generateId("snd");
            await db.insert(emailSends).values({
              id: sendId,
              workspaceId,
              contactId: contact.id,
              contactEmail: contact.email,
              campaignId: campaign.id,
              campaignStepId: firstStep.id,
              subject: stepConfig.subject ?? "Message from us",
              status: "queued",
            });
            await getSendEmailQueue().add("send-email", { sendId }, { removeOnComplete: 100 });
          }
        }

        logger.info({ campaignId: campaign.id, contactId: event.contactId, enrollmentId }, "Contact enrolled in campaign");
      }
    },
    { connection: getRedisConnection(), concurrency: 20 }
  );
}
