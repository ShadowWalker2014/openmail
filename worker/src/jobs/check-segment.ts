/**
 * check-segment worker
 *
 * Evaluates a single contact against all segments that are referenced by
 * active segment_enter / segment_exit campaigns, detects membership changes,
 * and enrolls the contact in matching campaigns.
 *
 * Triggered by:
 *   - PATCH /contacts/:id         (attribute or unsubscribe change)
 *   - POST /events/track          (new event affects event.* segment conditions)
 *   - POST /groups/:id/contacts   (group membership affects group.* conditions)
 *   - DELETE /groups/:id/contacts/:contactId  (same)
 *   - POST /api/ingest/identify   (contact upsert via ingest)
 *
 * Scale characteristics:
 *   - O(1 contact × N active-segment-triggered-campaigns) — never loads all contacts
 *   - contactMatchesSegment fetches only the single contact's events/groups
 *   - BullMQ rate limiter prevents thundering herd on bulk imports
 */

import { Worker } from "bullmq";
import { getWorkerRedisConnection } from "../lib/redis.js";
import { getDb } from "@openmail/shared/db";
import {
  campaigns, campaignEnrollments, campaignSteps,
  contacts, segmentMemberships,
} from "@openmail/shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { generateId } from "@openmail/shared/ids";
import { contactMatchesSegment } from "../lib/segment-evaluator.js";
import { enqueueNextStep } from "../lib/step-advance.js";
import { logger } from "../lib/logger.js";

export interface CheckSegmentJobData {
  contactId:   string;
  workspaceId: string;
  /** Informational — used for logging only */
  reason: "contact_updated" | "event_tracked" | "group_changed" | "ingest_identify";
}

export function createCheckSegmentWorker() {
  return new Worker<CheckSegmentJobData>(
    "segment-check",
    async (job) => {
      const { contactId, workspaceId, reason } = job.data;
      const db = getDb();

      // ── 1. Only proceed if there are active segment_enter/exit campaigns ──
      // Bail early to avoid touching the DB for workspaces with no such campaigns.
      const triggerCampaigns = await db
        .select()
        .from(campaigns)
        .where(and(
          eq(campaigns.workspaceId, workspaceId),
          eq(campaigns.status, "active"),
          inArray(campaigns.triggerType, ["segment_enter", "segment_exit"]),
        ));

      if (triggerCampaigns.length === 0) return;

      // ── 2. Collect unique segment IDs referenced by these campaigns ───────
      const segmentIds = [
        ...new Set(
          triggerCampaigns
            .map((c) => (c.triggerConfig as { segmentId?: string }).segmentId)
            .filter((id): id is string => !!id),
        ),
      ];

      if (segmentIds.length === 0) return;

      // ── 3. Verify contact exists and fetch email (needed for emailSends) ──
      const [contact] = await db
        .select({ id: contacts.id, email: contacts.email, unsubscribed: contacts.unsubscribed })
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)))
        .limit(1);

      if (!contact) return; // contact deleted between queuing and processing

      // ── 4. Get existing membership snapshot ───────────────────────────────
      const existingMemberships = await db
        .select({ segmentId: segmentMemberships.segmentId })
        .from(segmentMemberships)
        .where(and(
          eq(segmentMemberships.contactId, contactId),
          inArray(segmentMemberships.segmentId, segmentIds),
        ));

      const wasInSegment = new Set(existingMemberships.map((m) => m.segmentId));

      // ── 5. Evaluate current membership for each relevant segment ──────────
      // contactMatchesSegment is efficient: fetches only this contact's
      // events and group memberships, never the whole workspace.
      for (const segmentId of segmentIds) {
        const nowIn = await contactMatchesSegment(contactId, segmentId);
        const wasIn = wasInSegment.has(segmentId);

        if (nowIn === wasIn) continue; // no change — skip

        // ── 6. Update segment_memberships snapshot ────────────────────────
        if (nowIn) {
          await db
            .insert(segmentMemberships)
            .values({ workspaceId, segmentId, contactId })
            .onConflictDoNothing();
        } else {
          await db
            .delete(segmentMemberships)
            .where(and(
              eq(segmentMemberships.segmentId, segmentId),
              eq(segmentMemberships.contactId, contactId),
            ));
        }

        // ── 7. Enroll contact in matching campaigns ───────────────────────
        const triggerType = nowIn ? "segment_enter" : "segment_exit";
        const matchingCampaigns = triggerCampaigns.filter(
          (c) =>
            c.triggerType === triggerType &&
            (c.triggerConfig as { segmentId?: string }).segmentId === segmentId,
        );

        for (const campaign of matchingCampaigns) {
          // Check for existing active enrollment (idempotency guard)
          const [existing] = await db
            .select({ id: campaignEnrollments.id, status: campaignEnrollments.status })
            .from(campaignEnrollments)
            .where(and(
              eq(campaignEnrollments.campaignId, campaign.id),
              eq(campaignEnrollments.contactId, contactId),
            ))
            .limit(1);

          if (existing?.status === "active") {
            logger.info({ campaignId: campaign.id, contactId }, "Already actively enrolled, skipping");
            continue;
          }

          // Load campaign steps ordered by position
          const steps = await db
            .select()
            .from(campaignSteps)
            .where(eq(campaignSteps.campaignId, campaign.id))
            .orderBy(campaignSteps.position);

          if (steps.length === 0) {
            logger.warn({ campaignId: campaign.id }, "segment_enter/exit campaign has no steps");
            continue;
          }

          const firstStep = steps[0];

          // Upsert enrollment — re-activates previously completed/paused enrollments.
          // .returning() captures the persisted id (preserves existing id on conflict).
          const [enrollment] = await db
            .insert(campaignEnrollments)
            .values({
              id:            generateId("enr"),
              campaignId:    campaign.id,
              workspaceId,
              contactId,
              currentStepId: firstStep.id,
              status:        "active",
            })
            .onConflictDoUpdate({
              target: [campaignEnrollments.campaignId, campaignEnrollments.contactId],
              set: {
                status:        "active",
                currentStepId: firstStep.id,
                startedAt:     new Date(),
                completedAt:   null,
                updatedAt:     new Date(),
              },
            })
            .returning({ id: campaignEnrollments.id });

          logger.info(
            { campaignId: campaign.id, contactId, segmentId, triggerType, reason, enrollmentId: enrollment.id },
            "Contact enrolled via segment trigger — advancing to first step",
          );

          // Hand off to step-advance (handles email vs wait, unsubscribed, etc.)
          await enqueueNextStep(enrollment.id, -1);
        }
      }
    },
    {
      connection:  getWorkerRedisConnection(),
      concurrency: 20,
      // Rate limit prevents thundering-herd on bulk contact imports.
      // 100 contacts/sec × (N segments × ~5 DB queries) stays manageable.
      limiter: { max: 100, duration: 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  );
}
