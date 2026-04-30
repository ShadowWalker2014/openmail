/**
 * Stage 6 follow-up — Lifecycle webhook delivery worker.
 *
 * Receives one job per (webhook_endpoint, audit_event) pairing and POSTs the
 * event to the operator's HTTP endpoint with HMAC-SHA256 signing.
 *
 * Delivery semantics:
 *   - At-least-once: BullMQ exponential backoff on 5xx / network errors.
 *   - Permanent failures (4xx) → consecutive_failures bump, no retry within
 *     this delivery (BullMQ marks job failed). Operator endpoints returning
 *     4xx are signaling "don't retry, content rejected".
 *   - Disabled webhooks → skip silently (still log "skipped" at debug level).
 *
 * Wire format (POST request body):
 *   {
 *     "delivery_id": "wdl_<nanoid>",       // unique per attempt; idempotency key
 *     "event": "audit_drift_detected",
 *     "lifecycle_op_id": "lop_<nanoid>",   // correlation id from event payload
 *     "workspace_id": "ws_xxx",
 *     "campaign_id": "cmp_xxx",
 *     "enrollment_id": "eee_xxx" | null,
 *     "contact_id": "con_xxx" | null,
 *     "emitted_at": "2026-04-30T08:39:11.187Z",
 *     "payload": { ... },                  // full audit event payload
 *   }
 *
 * Headers sent:
 *   X-OpenMail-Delivery: <delivery_id>
 *   X-OpenMail-Event:    <event_type>
 *   X-OpenMail-Signature: sha256=<hex(HMAC-SHA256(secret, body))>
 *   Content-Type:        application/json
 *   User-Agent:          OpenMail-Webhook/1
 */
import { createHmac } from "crypto";
import { Queue, Worker, type Job } from "bullmq";
import { sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { getDb } from "@openmail/shared/db";
import {
  getQueueRedisConnection,
  getWorkerRedisConnection,
} from "../lib/redis.js";
import { logger } from "../lib/logger.js";

const QUEUE_NAME = "lifecycle-webhook-delivery" as const;

const deliveryIdAlphabet = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  16,
);
function newDeliveryId(): string {
  return `wdl_${deliveryIdAlphabet()}`;
}

function getMaxRetries(): number {
  const raw = process.env.LIFECYCLE_WEBHOOK_MAX_RETRIES;
  const n = raw ? Number.parseInt(raw, 10) : 6;
  return Number.isFinite(n) && n >= 0 ? n : 6;
}

function getTimeoutMs(): number {
  const raw = process.env.LIFECYCLE_WEBHOOK_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : 10_000;
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

export interface WebhookDeliveryJob {
  webhookId: string;
  workspaceId: string;
  event: string;
  lifecycleOpId: string;
  campaignId: string;
  enrollmentId: string | null;
  contactId: string | null;
  emittedAt: string; // ISO
  payload: Record<string, unknown>;
}

let _queue: Queue<WebhookDeliveryJob> | null = null;
function getDeliveryQueue(): Queue<WebhookDeliveryJob> {
  if (!_queue) {
    _queue = new Queue<WebhookDeliveryJob>(QUEUE_NAME, {
      connection: getQueueRedisConnection(),
    });
  }
  return _queue;
}

/**
 * Enqueue a delivery for every enabled webhook in `workspaceId` that is
 * subscribed to `event` (or subscribes to all events via empty array).
 *
 * Called from the drift sweeper today; reusable from any audit emitter.
 */
export async function enqueueWebhookDeliveries(
  data: Omit<WebhookDeliveryJob, "webhookId">,
): Promise<{ enqueued: number }> {
  const db = getDb();
  // Find enabled subscribers. event_types empty array = subscribe to ALL.
  const subscribers = (await db.execute(sql`
    SELECT id
      FROM lifecycle_webhooks
     WHERE workspace_id = ${data.workspaceId}::text
       AND enabled = true
       AND (cardinality(event_types) = 0 OR ${data.event}::text = ANY(event_types))
  `)) as unknown as Array<{ id: string }>;

  if (subscribers.length === 0) return { enqueued: 0 };

  const queue = getDeliveryQueue();
  await Promise.all(
    subscribers.map((s) =>
      queue.add(
        "deliver",
        { ...data, webhookId: s.id },
        {
          attempts: getMaxRetries() + 1,
          backoff: {
            type: "exponential",
            delay: 5_000, // 5s, 10s, 20s, 40s, 80s, 160s, 320s
          },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
          // Idempotency at queue level: jobId combines webhook + correlation.
          // If the SAME audit event is enqueued twice (e.g. emitter retried)
          // BullMQ rejects the duplicate.
          jobId: `${s.id}:${data.lifecycleOpId}:${data.event}`,
        },
      ),
    ),
  );
  logger.info(
    {
      event: data.event,
      lifecycle_op_id: data.lifecycleOpId,
      workspace_id: data.workspaceId,
      enqueued: subscribers.length,
    },
    "lifecycle-webhook: deliveries enqueued",
  );
  return { enqueued: subscribers.length };
}

interface DeliveryResult {
  status: number;
  ok: boolean;
  errorMessage?: string;
}

async function deliverOnce(
  data: WebhookDeliveryJob,
  url: string,
  secret: string,
): Promise<DeliveryResult> {
  const deliveryId = newDeliveryId();
  const body = JSON.stringify({
    delivery_id: deliveryId,
    event: data.event,
    lifecycle_op_id: data.lifecycleOpId,
    workspace_id: data.workspaceId,
    campaign_id: data.campaignId,
    enrollment_id: data.enrollmentId,
    contact_id: data.contactId,
    emitted_at: data.emittedAt,
    payload: data.payload,
  });
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "OpenMail-Webhook/1",
        "X-OpenMail-Delivery": deliveryId,
        "X-OpenMail-Event": data.event,
        "X-OpenMail-Signature": `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    });
    return { status: res.status, ok: res.ok };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      errorMessage: (err as Error).message ?? "fetch failed",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function updateTelemetry(
  webhookId: string,
  result: DeliveryResult,
): Promise<void> {
  const db = getDb();
  if (result.ok) {
    await db.execute(sql`
      UPDATE lifecycle_webhooks
         SET last_delivered_at = now(),
             last_status = ${result.status}::int,
             last_error = NULL,
             consecutive_failures = 0,
             updated_at = now()
       WHERE id = ${webhookId}::text
    `);
  } else {
    await db.execute(sql`
      UPDATE lifecycle_webhooks
         SET last_delivered_at = now(),
             last_status = ${result.status}::int,
             last_error = ${result.errorMessage ?? `HTTP ${result.status}`}::text,
             consecutive_failures = consecutive_failures + 1,
             updated_at = now()
       WHERE id = ${webhookId}::text
    `);
  }
}

export function createLifecycleWebhookWorker(): Worker<WebhookDeliveryJob> {
  return new Worker<WebhookDeliveryJob>(
    QUEUE_NAME,
    async (job: Job<WebhookDeliveryJob>) => {
      const data = job.data;
      const db = getDb();
      const rows = (await db.execute(sql`
        SELECT id, url, secret, enabled
          FROM lifecycle_webhooks
         WHERE id = ${data.webhookId}::text
         LIMIT 1
      `)) as unknown as Array<{
        id: string;
        url: string;
        secret: string;
        enabled: boolean;
      }>;

      if (rows.length === 0) {
        logger.debug(
          { webhook_id: data.webhookId },
          "lifecycle-webhook: endpoint deleted, dropping job",
        );
        return { skipped: "endpoint_deleted" };
      }
      const wh = rows[0];
      if (!wh.enabled) {
        logger.debug(
          { webhook_id: wh.id },
          "lifecycle-webhook: endpoint disabled, dropping job",
        );
        return { skipped: "disabled" };
      }

      const result = await deliverOnce(data, wh.url, wh.secret);
      await updateTelemetry(wh.id, result);

      if (!result.ok) {
        // 4xx → permanent failure: don't retry. 5xx / network → throw to
        // trigger BullMQ exponential backoff up to attempts limit.
        const isPermanent = result.status >= 400 && result.status < 500;
        logger.warn(
          {
            webhook_id: wh.id,
            event: data.event,
            lifecycle_op_id: data.lifecycleOpId,
            status: result.status,
            error: result.errorMessage,
            attempt: job.attemptsMade,
            isPermanent,
          },
          "lifecycle-webhook: delivery failed",
        );
        if (!isPermanent) {
          throw new Error(
            `webhook delivery transient failure: ${result.status} ${result.errorMessage ?? ""}`,
          );
        }
        // Permanent: return without throwing — BullMQ marks complete, no retry.
        return { delivered: false, status: result.status };
      }

      logger.info(
        {
          webhook_id: wh.id,
          event: data.event,
          lifecycle_op_id: data.lifecycleOpId,
          status: result.status,
        },
        "lifecycle-webhook: delivered",
      );
      return { delivered: true, status: result.status };
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: 8,
    },
  );
}

// Test/manual hook
export async function deliverWebhookOnce(
  data: WebhookDeliveryJob,
  url: string,
  secret: string,
): Promise<DeliveryResult> {
  const result = await deliverOnce(data, url, secret);
  await updateTelemetry(data.webhookId, result);
  return result;
}
