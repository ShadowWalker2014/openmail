import { Worker } from "bullmq";
import { sql, eq, and } from "drizzle-orm";
import { getWorkerRedisConnection } from "../lib/redis.js";
import { getDb } from "@openmail/shared/db";
import { events, campaigns, campaignEnrollments, campaignSteps } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { logger } from "../lib/logger.js";
import { advanceWithGoalCheck } from "../lib/advance-with-goal-check.js";
import { shouldAllowEnrollment, hashAttributes } from "../lib/re-enrollment-policy.js";
import { audit, type AuditTx } from "../lib/lifecycle-audit.js";
import { evaluateReactiveGoals } from "../lib/reactive-goal-eval.js";

export interface ProcessEventJobData {
  eventId: string;
  workspaceId: string;
  /**
   * Stage 2 [V2.5] / CR-15 — operation correlation id propagated from the
   * upstream emitter. When absent (legacy ingest path), the worker generates
   * a new one with prefix `lop_event_` so audit events still correlate.
   */
  lifecycle_op_id?: string;
}

export function createProcessEventWorker() {
  return new Worker<ProcessEventJobData>(
    "events",
    async (job) => {
      const db = getDb();
      const { eventId, workspaceId } = job.data;
      // Per Stage 2 [V2.5] CR-15 — request-scoped op_id binding.
      const lifecycleOpId =
        job.data.lifecycle_op_id ?? generateId("lop_event");
      const log = logger.child({ lifecycle_op_id: lifecycleOpId });

      const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
      if (!event || !event.contactId) return;
      const contactId: string = event.contactId;

      // Stage 1 invariant (CN-04 / CR-09): campaigns.status='active' filter MUST remain.
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

        // Quick guard: don't enroll into a campaign with no steps.
        const [stepCount] = await db
          .select({ id: campaignSteps.id })
          .from(campaignSteps)
          .where(eq(campaignSteps.campaignId, campaign.id))
          .limit(1);

        if (!stepCount) {
          log.warn({ campaignId: campaign.id }, "Campaign has no steps, skipping enrollment");
          continue;
        }

        // ─── Stage 2 — re-enrollment policy gate (CR-09, CN-04) ──────────
        // shouldAllowEnrollment emits `re_enrolled` / `re_enrollment_blocked`
        // audit events internally and returns idempotent skip on active match.
        const newEnrollmentId = generateId("enr");
        const upsertedId = await db.transaction(async (tx: AuditTx) => {
          const decision = await shouldAllowEnrollment(
            contactId,
            campaign.id,
            tx,
            lifecycleOpId,
          );

          if (!decision.allowed && decision.reason === "active_exists") {
            // Idempotent skip — silent (Stage 1 invariant).
            log.info(
              { campaignId: campaign.id, contactId },
              "Already actively enrolled, skipping",
            );
            return null;
          }

          if (!decision.allowed) {
            // Policy denial — `re_enrollment_blocked` already emitted in helper.
            log.info(
              { campaignId: campaign.id, contactId, reason: decision.reason },
              "Re-enrollment blocked by policy",
            );
            return null;
          }

          // Allowed — upsert the enrollment row.
          // currentStepId starts null; enqueueNextStep will set it.
          const [upserted] = (await tx
            .insert(campaignEnrollments)
            .values({
              id: newEnrollmentId,
              campaignId: campaign.id,
              workspaceId,
              contactId,
              currentStepId: null,
              status: "active",
            })
            .onConflictDoUpdate({
              target: [campaignEnrollments.campaignId, campaignEnrollments.contactId],
              set: {
                status: "active",
                currentStepId: null,
                startedAt: new Date(),
                completedAt: null,
                updatedAt: new Date(),
              },
            })
            .returning({ id: campaignEnrollments.id })) as Array<{ id: string }>;

          // Pull current contact attributes for the enrolled-event payload —
          // `on_attribute_change` policy uses this on the NEXT trigger.
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
                trigger: "event",
                event_id: eventId,
                event_name: event.name,
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
        // wrapper so a contact that already satisfies a goal on the same
        // event that triggered enrollment exits immediately rather than
        // sending step 0. completedPosition=-1 selects position 0 when no
        // goal matches.
        await advanceWithGoalCheck({
          enrollmentId: upsertedId,
          completedPosition: -1,
          triggeringEvent: {
            name: event.name,
            properties: (event.properties as Record<string, unknown> | null) ?? null,
            occurredAt: event.occurredAt,
          },
          lifecycleOpId,
        });

        log.info(
          { campaignId: campaign.id, contactId, enrollmentId: upsertedId },
          "Contact enrolled in campaign",
        );
      }

      // Stage 5 (T8) — reactive goal evaluation across ALL active enrollments
      // of this contact (not just the campaign that just enrolled them).
      // An incoming event might satisfy a goal on a DIFFERENT campaign the
      // contact is currently enrolled in. Skip on error — never block ingest.
      try {
        await evaluateReactiveGoals({
          workspaceId,
          contactId,
          triggeringEvent: {
            name: event.name,
            properties: (event.properties as Record<string, unknown> | null) ?? null,
            occurredAt: event.occurredAt,
          },
          lifecycleOpId,
        });
      } catch (err) {
        log.warn(
          { err, eventName: event.name, contactId },
          "reactive goal eval failed (non-fatal — primary event work already committed)",
        );
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
