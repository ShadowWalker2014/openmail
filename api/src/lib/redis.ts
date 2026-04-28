/**
 * Redis connection helpers for the api service.
 *
 * - getQueueRedisConnection / getWorkerRedisConnection: BullMQ connection
 *   configs (existing — used by ingest, events, broadcasts queues, and now
 *   campaign-cancel's step-execution queue handle).
 * - getRedisClient: lazy-init shared ioredis client for non-BullMQ uses
 *   (rate limiter, future cache work). ioredis is a transitive dep of bullmq;
 *   no new package install needed.
 */

import IORedis, { type Redis } from "ioredis";

function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
  };
}

// Workers must retry indefinitely so in-flight jobs are not lost during
// transient Redis outages. BullMQ requires maxRetriesPerRequest: null here.
export function getWorkerRedisConnection() {
  return { ...parseRedisUrl(process.env.REDIS_URL!), maxRetriesPerRequest: null as null };
}

// Queues/producers should fail fast so callers can surface errors immediately
// rather than blocking the request handler indefinitely on Redis unavailability.
export function getQueueRedisConnection() {
  return parseRedisUrl(process.env.REDIS_URL!);
}

/**
 * Lazy-init shared ioredis client for non-BullMQ uses (rate limiter, etc.).
 */
let _client: Redis | null = null;
export function getRedisClient(): Redis {
  if (!_client) {
    const cfg = parseRedisUrl(process.env.REDIS_URL!);
    _client = new IORedis(cfg);
  }
  return _client;
}
