/**
 * Stage 6 — Transactional outbox forwarder (REQ-12, [A6.1], CR-11).
 *
 * Polls `campaign_edit_outbox` for `forwarded_at IS NULL` rows and publishes
 * them to the Redis `campaign-edits` channel, then UPDATEs `forwarded_at`.
 * The reconciliation worker subscribes to that channel.
 *
 * Why poll instead of LISTEN/NOTIFY: simplicity + cross-replica safety.
 * Multiple worker replicas can poll concurrently; the partial unique-on-FIFO
 * effect comes from FOR UPDATE SKIP LOCKED on the SELECT, ensuring two
 * replicas never publish the same row.
 *
 * On startup: also process unforwarded rows older than 1h (recovery from
 * extended downtime) — same query, no special path; the partial index keeps
 * scans bounded.
 *
 * Queue: `lifecycle-outbox-poller` — a repeatable job that fires every
 * `LIFECYCLE_OUTBOX_POLL_INTERVAL_MS` ms (default 1000ms).
 */
import { Queue, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { getDb } from "@openmail/shared/db";
import {
  getQueueRedisConnection,
  getWorkerRedisConnection,
} from "../lib/redis.js";
import { logger } from "../lib/logger.js";

const QUEUE_NAME = "lifecycle-outbox-poller" as const;
const JOB_NAME = "outbox-poll" as const;
export const CAMPAIGN_EDITS_CHANNEL = "campaign-edits" as const;

function getPollIntervalMs(): number {
  const raw = process.env.LIFECYCLE_OUTBOX_POLL_INTERVAL_MS;
  const n = raw ? Number.parseInt(raw, 10) : 1_000;
  return Number.isFinite(n) && n > 0 ? n : 1_000;
}

function getBatchSize(): number {
  const raw = process.env.LIFECYCLE_OUTBOX_BATCH_SIZE;
  const n = raw ? Number.parseInt(raw, 10) : 100;
  return Number.isFinite(n) && n > 0 ? n : 100;
}

let _pub: Redis | null = null;
function getPublisher(): Redis {
  if (!_pub) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is required for outbox worker");
    const u = new URL(url);
    _pub = new Redis({
      host: u.hostname,
      port: Number(u.port) || 6379,
      password: u.password || undefined,
      username: u.username || undefined,
      maxRetriesPerRequest: null,
    });
  }
  return _pub;
}

let _queue: Queue | null = null;
function getOutboxQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: getQueueRedisConnection() });
  }
  return _queue;
}

export async function ensureOutboxPollerSchedule(): Promise<void> {
  const intervalMs = getPollIntervalMs();
  await getOutboxQueue().add(
    JOB_NAME,
    {},
    {
      repeat: { every: intervalMs },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
      jobId: `${QUEUE_NAME}:repeat`,
    },
  );
  logger.info(
    { queue: QUEUE_NAME, intervalMs },
    "outbox-poller schedule installed",
  );
}

interface OutboxRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  edit_type: string;
  details: Record<string, unknown>;
  lifecycle_op_id: string;
  created_at: Date | string;
}

async function processOnce(): Promise<{ forwarded: number }> {
  const db = getDb();
  const batchSize = getBatchSize();
  let forwarded = 0;

  // FOR UPDATE SKIP LOCKED + UPDATE in same tx: no replica races.
  await db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id, workspace_id, campaign_id, edit_type, details,
             lifecycle_op_id, created_at
        FROM campaign_edit_outbox
       WHERE forwarded_at IS NULL
       ORDER BY id ASC
       LIMIT ${batchSize}
       FOR UPDATE SKIP LOCKED
    `)) as unknown as OutboxRow[];

    if (rows.length === 0) return;

    const pub = getPublisher();
    for (const row of rows) {
      const message = JSON.stringify({
        outboxId: row.id.toString(),
        workspaceId: row.workspace_id,
        campaignId: row.campaign_id,
        editType: row.edit_type,
        details: row.details ?? {},
        lifecycleOpId: row.lifecycle_op_id,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : row.created_at,
      });
      try {
        await pub.publish(CAMPAIGN_EDITS_CHANNEL, message);
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, outboxId: row.id.toString() },
          "outbox: redis publish failed (will retry next poll)",
        );
        continue; // do not mark forwarded if publish failed
      }
      await tx.execute(sql`
        UPDATE campaign_edit_outbox
           SET forwarded_at = now()
         WHERE id = ${row.id}
      `);
      forwarded++;
    }
  });
  return { forwarded };
}

export function createOutboxWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const start = Date.now();
      const { forwarded } = await processOnce();
      if (forwarded > 0) {
        logger.info(
          { forwarded, durationMs: Date.now() - start },
          "outbox: batch forwarded",
        );
      }
      return { forwarded };
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: 1, // single forwarder per replica; FOR UPDATE SKIP LOCKED handles cross-replica
    },
  );
  return worker;
}
