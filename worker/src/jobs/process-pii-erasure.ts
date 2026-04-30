/**
 * Stage 6 — PII redaction worker (REQ-27, [A6.4], CR-15, CN-08 exception, GDPR Art. 17).
 *
 * Triggered by contact deletion (T13 in API). Walks `enrollment_events` AND
 * `enrollment_events_archive` for the deleted contact and REPLACES the
 * `payload`, `before`, `after` JSONB fields with a redacted sentinel:
 *
 *   {
 *     redacted: true,
 *     reason: "gdpr_erasure",
 *     redacted_at: <timestamptz>,
 *     original_event_type: <event_type>
 *   }
 *
 * PRESERVES bit-exact (CR-15):
 *   - id, event_type, emitted_at, event_seq, actor, tx_id, payload_version
 *   - enrollment_id, campaign_id, contact_id, workspace_id
 *
 * Why preserve metadata: replay must still see the chronological event log;
 * the dispatcher detects `redacted: true` payloads and treats them as opaque
 * (warning, NOT drift) — see `scripts/lib/replay-event-dispatch.ts`.
 *
 * This is the ONLY exception to Stage 2 [CN-08] append-only invariant.
 *
 * Emits a campaign-aggregate `pii_erased` event PER CAMPAIGN the contact had
 * events in (so dashboards can show "this contact's data was erased on X").
 *
 * Queue: `lifecycle-pii-erasure`. Triggered manually via .add() from the
 * contact-delete API handler — not on a cron.
 */
import { Queue, Worker, type Job } from "bullmq";
import { sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { getDb } from "@openmail/shared/db";
import {
  getQueueRedisConnection,
  getWorkerRedisConnection,
} from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { audit } from "../lib/lifecycle-audit.js";
import { LIFECYCLE_OP_ID_LENGTH } from "@openmail/shared";

const QUEUE_NAME = "lifecycle-pii-erasure" as const;
const JOB_NAME = "erase-contact" as const;

export interface PiiErasureJobData {
  contactId: string;
  workspaceId: string;
  /** Optional override op-id (defaults to fresh `lop_pii_*`). */
  lifecycleOpId?: string;
}

const opIdAlphabet = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  LIFECYCLE_OP_ID_LENGTH,
);
function newOpId(): string {
  return `lop_pii_${opIdAlphabet()}`;
}

let _queue: Queue<PiiErasureJobData> | null = null;
function getQueue(): Queue<PiiErasureJobData> {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: getQueueRedisConnection() });
  }
  return _queue;
}

/** Public enqueue entry — called from API DELETE /contacts/:id handler. */
export async function enqueuePiiErasure(data: PiiErasureJobData): Promise<void> {
  await getQueue().add(JOB_NAME, data, {
    attempts: 5,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  });
}

interface CampaignAgg {
  campaign_id: string;
  workspace_id: string;
  cnt: number;
}

async function eraseContact(
  contactId: string,
  workspaceId: string,
  lifecycleOpId: string,
): Promise<{
  primaryUpdated: number;
  archiveUpdated: number;
  perCampaign: Array<{ campaignId: string; eventCount: number }>;
}> {
  const db = getDb();
  let primaryUpdated = 0;
  let archiveUpdated = 0;
  const perCampaign: Array<{ campaignId: string; eventCount: number }> = [];

  await db.transaction(async (tx) => {
    // Pass the audit_chokepoint trigger guard for any incidental writes.
    await tx.execute(sql`SET LOCAL lifecycle.audited_tx = 'true'`);

    // Aggregate per-campaign counts BEFORE redaction (otherwise the redacted
    // payload still has the campaign_id column intact, but reading easier
    // up-front).
    const aggPrimary = (await tx.execute(sql`
      SELECT campaign_id, workspace_id, COUNT(*)::int AS cnt
        FROM enrollment_events
       WHERE contact_id = ${contactId}
         AND workspace_id = ${workspaceId}
       GROUP BY campaign_id, workspace_id
    `)) as unknown as CampaignAgg[];
    const aggArchive = (await tx.execute(sql`
      SELECT campaign_id, workspace_id, COUNT(*)::int AS cnt
        FROM enrollment_events_archive
       WHERE contact_id = ${contactId}
         AND workspace_id = ${workspaceId}
       GROUP BY campaign_id, workspace_id
    `)) as unknown as CampaignAgg[];
    const merged = new Map<string, number>();
    for (const r of [...aggPrimary, ...aggArchive]) {
      merged.set(r.campaign_id, (merged.get(r.campaign_id) ?? 0) + Number(r.cnt));
    }
    for (const [cId, n] of merged) {
      perCampaign.push({ campaignId: cId, eventCount: n });
    }

    // UPDATE primary table.
    const r1 = (await tx.execute(sql`
      UPDATE enrollment_events
         SET payload = jsonb_build_object(
                         'redacted', true,
                         'reason', 'gdpr_erasure',
                         'redacted_at', now()::text,
                         'original_event_type', event_type,
                         'lifecycle_op_id', ${lifecycleOpId}
                       ),
             "before" = NULL,
             "after"  = NULL
       WHERE contact_id = ${contactId}
         AND workspace_id = ${workspaceId}
       RETURNING id
    `)) as unknown as Array<{ id: string }>;
    primaryUpdated = r1.length;

    // UPDATE archive.
    const r2 = (await tx.execute(sql`
      UPDATE enrollment_events_archive
         SET payload = jsonb_build_object(
                         'redacted', true,
                         'reason', 'gdpr_erasure',
                         'redacted_at', now()::text,
                         'original_event_type', event_type,
                         'lifecycle_op_id', ${lifecycleOpId}
                       ),
             "before" = NULL,
             "after"  = NULL
       WHERE contact_id = ${contactId}
         AND workspace_id = ${workspaceId}
       RETURNING id
    `)) as unknown as Array<{ id: string }>;
    archiveUpdated = r2.length;
  });

  // Emit pii_erased aggregate events (outside redaction tx). One per campaign.
  for (const { campaignId, eventCount } of perCampaign) {
    try {
      await audit.emit(
        null,
        "pii_erased",
        {
          campaignId,
          workspaceId,
          contactId: null,
          actor: { kind: "sweeper", runId: lifecycleOpId },
          payload: {
            lifecycle_op_id: lifecycleOpId,
            contact_id: contactId,
            event_count: eventCount,
          },
        },
      );
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, contactId, campaignId },
        "pii-erasure: pii_erased emit failed (non-fatal)",
      );
    }
  }

  return { primaryUpdated, archiveUpdated, perCampaign };
}

export function createPiiErasureWorker(): Worker<PiiErasureJobData> {
  return new Worker<PiiErasureJobData>(
    QUEUE_NAME,
    async (job: Job<PiiErasureJobData>) => {
      const { contactId, workspaceId, lifecycleOpId } = job.data;
      const opId = lifecycleOpId ?? newOpId();
      const start = Date.now();
      const result = await eraseContact(contactId, workspaceId, opId);
      logger.info(
        {
          contactId,
          workspaceId,
          lifecycle_op_id: opId,
          primaryUpdated: result.primaryUpdated,
          archiveUpdated: result.archiveUpdated,
          campaigns: result.perCampaign.length,
          durationMs: Date.now() - start,
        },
        "pii-erasure: contact redacted",
      );
      return result;
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: 1,
    },
  );
}

// Test/manual hook
export async function eraseContactOnce(
  contactId: string,
  workspaceId: string,
): Promise<{ primaryUpdated: number; archiveUpdated: number }> {
  return eraseContact(contactId, workspaceId, newOpId());
}
