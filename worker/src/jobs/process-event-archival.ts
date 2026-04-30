/**
 * Stage 6 — Event archival worker (REQ-17, [A6.3], CR-05, CR-14, CN-11).
 *
 * Runs daily (default 4am) via BullMQ repeatable cron. For each workspace
 * with events older than `LIFECYCLE_AUDIT_RETENTION_DAYS` (default 180):
 *
 *   1. Acquire `pg_advisory_xact_lock(hashtext('archival:workspace:'||id))`
 *      — serializes within workspace, parallelizes across workspaces.
 *   2. `SET LOCAL application_name = 'archival-low-priority'` for monitoring.
 *   3. Batched (10000): single transaction
 *      WITH to_archive AS (
 *        DELETE FROM enrollment_events
 *         WHERE workspace_id = $1 AND emitted_at < $cutoff
 *         ORDER BY (workspace_id, emitted_at)
 *         LIMIT $batch
 *         RETURNING *
 *      )
 *      INSERT INTO enrollment_events_archive
 *      SELECT id, enrollment_id, campaign_id, contact_id, workspace_id,
 *             event_type, payload_version, payload, "before", "after",
 *             actor, event_seq, tx_id, emitted_at
 *        FROM to_archive
 *
 *   4. Loop until 0 rows archived (workspace exhausted for this run).
 *   5. Emit aggregate `events_archived` audit event per workspace per run.
 *
 * MUST NOT acquire table-level lock (CN-11) — ElectricSQL syncs need
 * row-level locking only.
 */
import { Queue, Worker } from "bullmq";
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

const QUEUE_NAME = "lifecycle-archival" as const;
const JOB_NAME = "archival-run" as const;

function getRetentionDays(): number {
  const raw = process.env.LIFECYCLE_AUDIT_RETENTION_DAYS;
  const n = raw ? Number.parseInt(raw, 10) : 180;
  return Number.isFinite(n) && n > 0 ? n : 180;
}

function getBatchSize(): number {
  const raw = process.env.LIFECYCLE_ARCHIVAL_BATCH_SIZE;
  const n = raw ? Number.parseInt(raw, 10) : 10_000;
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

function getCronSpec(): string {
  return process.env.LIFECYCLE_ARCHIVAL_CRON ?? "0 4 * * *"; // 04:00 UTC daily
}

const opIdAlphabet = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  LIFECYCLE_OP_ID_LENGTH,
);
function newOpId(): string {
  return `lop_arch_${opIdAlphabet()}`;
}

let _queue: Queue | null = null;
function getArchivalQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: getQueueRedisConnection() });
  }
  return _queue;
}

export async function ensureArchivalSchedule(): Promise<void> {
  await getArchivalQueue().add(
    JOB_NAME,
    {},
    {
      repeat: { pattern: getCronSpec() },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
      jobId: `${QUEUE_NAME}:repeat`,
    },
  );
  logger.info(
    { queue: QUEUE_NAME, cron: getCronSpec(), retentionDays: getRetentionDays() },
    "archival schedule installed",
  );
}

interface ArchiveStats {
  workspaceId: string;
  archivedCount: number;
  cutoffAt: Date;
  batches: number;
  durationMs: number;
}

async function archiveWorkspace(
  workspaceId: string,
  cutoff: Date,
  lifecycleOpId: string,
): Promise<ArchiveStats> {
  const db = getDb();
  const batchSize = getBatchSize();
  const start = Date.now();
  let archivedTotal = 0;
  let batches = 0;

  // Workspace-scoped advisory lock (transactional). Two replicas archiving
  // the same workspace simultaneously would otherwise produce duplicate
  // INSERTs — actually, the DELETE...RETURNING is atomic so this is more
  // about pacing than correctness.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`archival:workspace:${workspaceId}`}))`,
    );
    await tx.execute(sql`SET LOCAL application_name = 'archival-low-priority'`);

    while (true) {
      // Single-statement DELETE+INSERT via WITH; deletes up to batchSize rows
      // ordered by (workspace_id, emitted_at) so we always start from the
      // oldest. RETURNING * gives the archived rows; INSERT into archive.
      // The composite ORDER ... LIMIT inside the CTE works since Postgres
      // 14+ supports ORDER BY in DELETE...RETURNING via subquery wrapper.
      const cutoffIso = cutoff.toISOString();
      const result = (await tx.execute(sql`
        WITH to_delete AS (
          SELECT id
            FROM enrollment_events
           WHERE workspace_id = ${workspaceId}::text
             AND emitted_at < ${cutoffIso}::timestamptz
           ORDER BY emitted_at ASC
           LIMIT ${batchSize}
           FOR UPDATE SKIP LOCKED
        ),
        deleted AS (
          DELETE FROM enrollment_events e
            USING to_delete d
           WHERE e.id = d.id
          RETURNING e.*
        )
        INSERT INTO enrollment_events_archive (
          id, enrollment_id, campaign_id, contact_id, workspace_id,
          event_type, payload_version, payload, "before", "after",
          actor, event_seq, tx_id, emitted_at
        )
        SELECT id, enrollment_id, campaign_id, contact_id, workspace_id,
               event_type, payload_version, payload, "before", "after",
               actor, event_seq, tx_id, emitted_at
          FROM deleted
        RETURNING id
      `)) as unknown as Array<{ id: string }>;

      const n = result.length;
      if (n === 0) break;
      archivedTotal += n;
      batches++;
      // Avoid runaway: hard cap on batches per workspace per run (~1M rows).
      if (batches >= 100) break;
    }
  });

  // Emit aggregate audit event (outside the archival tx — uses its own).
  if (archivedTotal > 0) {
    try {
      // events_archived is a "campaign-aggregate" event but workspace-wide;
      // we use a synthetic campaignId="" since the schema requires non-null.
      // Operators can still query by workspace_id.
      // Actually, schema enforces campaign_id NOT NULL — we need a real
      // sentinel. Using `__archival__` as a reserved campaign_id used only
      // for this synthetic record. (Stage 6 [A6.3]: aggregate per workspace
      // per run.)
      await audit.emit(
        null,
        "events_archived",
        {
          campaignId: "__archival__",
          workspaceId,
          contactId: null,
          actor: { kind: "sweeper", runId: lifecycleOpId },
          payload: {
            lifecycle_op_id: lifecycleOpId,
            archived_count: archivedTotal,
            cutoff_at: cutoff.toISOString(),
            workspace_id: workspaceId,
          },
        },
      );
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, workspaceId },
        "archival: events_archived audit emit failed (non-fatal)",
      );
    }
  }

  return {
    workspaceId,
    archivedCount: archivedTotal,
    cutoffAt: cutoff,
    batches,
    durationMs: Date.now() - start,
  };
}

async function listWorkspacesWithOldEvents(cutoff: Date): Promise<string[]> {
  const db = getDb();
  const cutoffIso = cutoff.toISOString();
  const rows = (await db.execute(sql`
    SELECT DISTINCT workspace_id
      FROM enrollment_events
     WHERE emitted_at < ${cutoffIso}::timestamptz
     LIMIT 1000
  `)) as unknown as Array<{ workspace_id: string }>;
  return rows.map((r) => r.workspace_id);
}

async function runArchival(): Promise<{
  workspacesProcessed: number;
  totalArchived: number;
}> {
  const cutoff = new Date(Date.now() - getRetentionDays() * 86400 * 1000);
  const workspaces = await listWorkspacesWithOldEvents(cutoff);
  let totalArchived = 0;
  for (const wsId of workspaces) {
    try {
      const stats = await archiveWorkspace(wsId, cutoff, newOpId());
      totalArchived += stats.archivedCount;
      if (stats.archivedCount > 0) {
        logger.info(
          { ...stats, cutoffAt: stats.cutoffAt.toISOString() },
          "archival: workspace processed",
        );
      }
    } catch (err) {
      logger.error(
        { err: (err as Error).message, workspaceId: wsId },
        "archival: workspace failed (continuing with next)",
      );
    }
  }
  return { workspacesProcessed: workspaces.length, totalArchived };
}

export function createArchivalWorker(): Worker {
  return new Worker(
    QUEUE_NAME,
    async () => {
      const start = Date.now();
      const stats = await runArchival();
      logger.info(
        { ...stats, durationMs: Date.now() - start },
        "archival: run complete",
      );
      return stats;
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: 1,
    },
  );
}

// Test/manual hook
export async function runArchivalOnce(): Promise<{
  workspacesProcessed: number;
  totalArchived: number;
}> {
  return runArchival();
}
