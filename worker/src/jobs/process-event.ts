import { Worker } from "bullmq";
import { getWorkerRedisConnection } from "../lib/redis.js";
import { getDb } from "@openmail/shared/db";
import { events, campaigns, campaignEnrollments, campaignSteps } from "@openmail/shared/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "@openmail/shared/ids";
import { enqueueNextStep } from "../lib/step-advance.js";
import { logger } from "../lib/logger.js";

export interface ProcessEventJobData {
  eventId: string;
  workspaceId: string;
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

        // Upsert enrollment. .returning() captures the actual id (preserves
        // existing id on conflict instead of using the freshly-generated one).
        const [enrollment] = await db.insert(campaignEnrollments).values({
          id: generateId("enr"),
          campaignId: campaign.id,
          workspaceId,
          contactId: event.contactId,
          currentStepId: firstStep.id,
          status: "active",
        }).onConflictDoUpdate({
          target: [campaignEnrollments.campaignId, campaignEnrollments.contactId],
          set: { status: "active", currentStepId: firstStep.id, startedAt: new Date(), completedAt: null, updatedAt: new Date() },
        }).returning({ id: campaignEnrollments.id });

        logger.info(
          { campaignId: campaign.id, contactId: event.contactId, enrollmentId: enrollment.id },
          "Contact enrolled in campaign — advancing to first step",
        );

        // Hand off to step-advance — it dispatches by step type and respects unsubscribed.
        await enqueueNextStep(enrollment.id, -1);
      }
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: 20,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    }
  );
}
