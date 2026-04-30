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
 *
 * Stage 2 additions (T11):
 *   - lifecycle_op_id propagated via job data; generated locally with prefix
 *     `lop_segment_` when absent (CR-15, [V2.5])
 *   - shouldAllowEnrollment gates each enrollment per campaign re-enrollment
 *     policy (REQ-15, CR-09)
 */

import { Worker } from "bullmq";
import { sql, eq, and, inArray } from "drizzle-orm";
import { getWorkerRedisConnection } from "../lib/redis.js";
import { getDb } from "@openmail/shared/db";
import {
  campaigns, campaignEnrollments, campaignSteps,
  contacts, segmentMemberships,
} from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { contactMatchesSegment } from "../lib/segment-evaluator.js";
import { logger } from "../lib/logger.js";
// Stage 5 (T7): goal-aware advance wrapper.
import { advanceWithGoalCheck } from "../lib/advance-with-goal-check.js";
import { shouldAllowEnrollment, hashAttributes } from "../lib/re-enrollment-policy.js";
import { audit, type AuditTx } from "../lib/lifecycle-audit.js";

export interface CheckSegmentJobData {
  contactId:   string;
  workspaceId: string;
  /** Informational — used for logging only */
  reason: "contact_updated" | "event_tracked" | "group_changed" | "ingest_identify";
  /**
   * Stage 2 [V2.5] / CR-15 — operation correlation id propagated from upstream.
   * Generated locally with `lop_segment_` prefix when absent.
   */
  lifecycle_op_id?: string;
}

export function createCheckSegmentWorker() {
  return new Worker<CheckSegmentJobData>(
    "segment-check",
    async (job) => {
      const { contactId, workspaceId, reason } = job.data;
      const db = getDb();
      const lifecycleOpId =
        job.data.lifecycle_op_id ?? generateId("lop_segment");
      const log = logger.child({ lifecycle_op_id: lifecycleOpId });

      // ── 1. Only proceed if there are active segment_enter/exit campaigns ──
      // Stage 1 invariant (CN-04 / CR-09): campaigns.status='active' filter MUST remain.
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

      // ── 3. Verify contact exists in this workspace ───────────────────────
      const [contact] = await db
        .select({ id: contacts.id })
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
          // Quick guard: skip enrollment for campaigns with no steps.
          const [hasStep] = await db
            .select({ id: campaignSteps.id })
            .from(campaignSteps)
            .where(eq(campaignSteps.campaignId, campaign.id))
            .limit(1);

          if (!hasStep) {
            log.warn({ campaignId: campaign.id }, "segment_enter/exit campaign has no steps");
            continue;
          }

          // ─── Stage 2 — re-enrollment policy gate + audited upsert ──────
          const newEnrollmentId = generateId("enr");
          const upsertedId = await db.transaction(async (tx: AuditTx) => {
            const decision = await shouldAllowEnrollment(
              contactId,
              campaign.id,
              tx,
              lifecycleOpId,
            );

            if (!decision.allowed && decision.reason === "active_exists") {
              log.info(
                { campaignId: campaign.id, contactId },
                "Already actively enrolled, skipping",
              );
              return null;
            }

            if (!decision.allowed) {
              log.info(
                { campaignId: campaign.id, contactId, reason: decision.reason },
                "Re-enrollment blocked by policy",
              );
              return null;
            }

            // Upsert enrollment — re-activates previously completed/paused enrollments.
            const [upserted] = (await tx
              .insert(campaignEnrollments)
              .values({
                id:            newEnrollmentId,
                campaignId:    campaign.id,
                workspaceId,
                contactId,
                currentStepId: null,
                status:        "active",
              })
              .onConflictDoUpdate({
                target: [campaignEnrollments.campaignId, campaignEnrollments.contactId],
                set: {
                  status:        "active",
                  currentStepId: null,
                  startedAt:     new Date(),
                  completedAt:   null,
                  updatedAt:     new Date(),
                },
              })
              .returning({ id: campaignEnrollments.id })) as Array<{ id: string }>;

            const contactRow = (await tx.execute<{ attributes: unknown }>(
              sql`SELECT attributes FROM contacts WHERE id = ${contactId} LIMIT 1`,
            )) as unknown as Array<{ attributes: unknown }>;
            const attributes = contactRow[0]?.attributes ?? null;

            await audit.emit(
              upserted!.id,
              "enrolled",
              {
                campaignId: campaign.id,
                workspaceId,
                contactId,
                actor: { kind: "system" },
                payload: {
                  lifecycle_op_id: lifecycleOpId,
                  trigger: triggerType,
                  segment_id: segmentId,
                  reason,
                  attributes_hash: hashAttributes(attributes),
                  re_enrollment_reason: decision.reason,
                },
              },
              tx,
            );

            return upserted!.id;
          });

          if (!upsertedId) continue;

          // Stage 5 (T7): kick off step-chain progression via the goal-aware
          // wrapper so contacts satisfying a goal at the moment of enrollment
          // exit cleanly. No triggeringEvent here (segment trigger ≠ event).
          await advanceWithGoalCheck({
            enrollmentId: upsertedId,
            completedPosition: -1,
            lifecycleOpId,
          });

          log.info(
            { campaignId: campaign.id, contactId, segmentId, triggerType, reason, enrollmentId: upsertedId },
            "Contact enrolled via segment trigger",
          );
        }
      }
    },
    {
      connection:  getWorkerRedisConnection(),
      concurrency: 20,
      // Rate limit prevents thundering-herd on bulk contact imports.
      limiter: { max: 100, duration: 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  );
}
