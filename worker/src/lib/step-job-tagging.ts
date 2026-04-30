/**
 * Stage 4 — Step Job Tagging (REQ-08, CR-02, DB-02)
 *
 * BullMQ has no native API to enumerate "all delayed wait jobs for stepId X".
 * We solve this by maintaining a Redis SET keyed by stepId that lists every
 * jobId currently in-flight for that step. The pause endpoint reads this SET
 * and removes each job by exact deterministic jobId — no SCAN, no wildcards.
 *
 * Lifecycle:
 *   - On wait-step enqueue (Stage 1's `enqueueNextStep`) → `tagJob(stepId, jobId)`
 *   - On wait-step completion / failure / cancellation   → `untagJob(stepId, jobId)`
 *   - On pause → `getJobsForStep(stepId)` → bulk remove from BullMQ → SREM all
 *
 * Idempotency:
 *   - SADD/SREM are idempotent on duplicates / missing entries
 *   - Reading a non-existent SET returns empty array
 *
 * Crash safety:
 *   - If worker crashes between BullMQ.add and tagJob → orphan job. Sweeper
 *     (Stage 4 T7) detects `step.status='paused' AND BullMQ has tagged jobs`
 *     and reconciles.
 *
 * Key format: `bullmq:wait-jobs:step:{stepId}` — namespaced under bullmq:
 *   to keep step tags clearly distinct from BullMQ's own keyspace
 *   (BullMQ uses `bull:<queueName>:*` by default, no overlap).
 *
 * Connection: shares the queue Redis connection conventions (fail-fast).
 *   The worker's `getQueueRedisConnection()` returns plain config (no
 *   maxRetries override), suitable for a dedicated ioredis instance here.
 */
import { Redis } from "ioredis";

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for step-job-tagging");
  const parsed = new URL(url);
  _redis = new Redis({
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });
  return _redis;
}

/** Test-only: reset the cached Redis client so a new env var is honored. */
export function __resetRedisForTests(): void {
  if (_redis) {
    _redis.quit().catch(() => {});
    _redis = null;
  }
}

function stepKey(stepId: string): string {
  return `bullmq:wait-jobs:step:${stepId}`;
}

/**
 * Tag a BullMQ wait-step jobId as belonging to stepId.
 * Called immediately AFTER `Queue.add(...)` succeeds.
 *
 * Idempotent: SADD-ing an existing member returns 0; no error.
 */
export async function tagJob(stepId: string, jobId: string): Promise<void> {
  await getRedis().sadd(stepKey(stepId), jobId);
}

/**
 * Untag a jobId from stepId's set. Called when:
 *   - wait-step job completes successfully (process-step.ts)
 *   - wait-step job fails permanently (worker error handler)
 *   - wait-step job is cancelled by Stage 1's `cancelEnrollmentJob`
 *
 * Idempotent: SREM-ing a non-member returns 0; no error.
 */
export async function untagJob(stepId: string, jobId: string): Promise<void> {
  await getRedis().srem(stepKey(stepId), jobId);
}

/**
 * Get all jobIds currently tagged for stepId. Used by:
 *   - pause endpoint to bulk-remove BullMQ jobs (CR-02 exhaustive)
 *   - drain sweeper to detect orphan jobs at paused steps (T7)
 *
 * Returns empty array if no jobs are tagged (or stepId never had any).
 * Order is NOT guaranteed (Redis SMEMBERS is unordered).
 */
export async function getJobsForStep(stepId: string): Promise<string[]> {
  return await getRedis().smembers(stepKey(stepId));
}

/**
 * Convenience: remove ALL jobIds from a step's tag set in one shot.
 * Used by the pause endpoint AFTER `queue.getJob(jobId).remove()` for each.
 *
 * If you have specific jobIds, prefer per-job `untagJob` so the SET stays
 * accurate for sweeper consistency. This helper is for the "pause completed,
 * empty the bucket" terminal step.
 */
export async function clearStepTags(stepId: string): Promise<number> {
  return await getRedis().del(stepKey(stepId));
}
