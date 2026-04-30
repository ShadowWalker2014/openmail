/**
 * Goal cache (Stage 5 — T6, [DB-04], [A5.5]).
 *
 * L1 in-process LRU keyed by campaignId. Avoids hitting Postgres on every
 * step-advance hot-path call to evaluate goals (CR-09 — must not regress
 * step-advance throughput by >10ms p95).
 *
 * Invalidation strategy ([A5.5] "honest" invalidation):
 *  - Producer (API CRUD) calls `publishInvalidate(campaignId)` after the
 *    DB mutation commits. Local LRU is invalidated synchronously; remote
 *    workers receive the pub/sub message and invalidate too.
 *  - Cross-worker delivery is best-effort (Redis pub/sub is fire-and-forget
 *    on the client side; subscribers that are connected at publish time get
 *    the message). The TTL bound (`LIFECYCLE_GOAL_CACHE_TTL_SECONDS`)
 *    guarantees stale entries refresh within that window even if a worker
 *    misses a pub/sub message (e.g. due to brief reconnect).
 *  - This is "honest invalidation" — we do NOT promise zero staleness across
 *    a fleet of workers; we promise bounded staleness.
 *
 * Concurrency:
 *  - LRU operations are synchronous in JS, so no lock needed.
 *  - DB load (`getCachedGoals` cache miss) is unguarded — if two callers race
 *    on a miss, we'll just do the DB query twice; correctness preserved.
 *
 * Why no `lru-cache` dep:
 *  - Worker package has zero external runtime caching deps; we keep it that
 *    way. A simple Map + manual eviction (oldest insertion) is enough at
 *    `LIFECYCLE_GOAL_CACHE_LRU_SIZE=1000` default.
 */
import { eq, and } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import { campaignGoals } from "@openmail/shared/schema";
import type { CampaignGoal } from "@openmail/shared";
import { logger } from "./logger.js";

// ── Tunables (lazy env reads) ────────────────────────────────────────────────

function getMaxSize(): number {
  const raw = process.env.LIFECYCLE_GOAL_CACHE_LRU_SIZE;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}

function getTtlMs(): number {
  const raw = process.env.LIFECYCLE_GOAL_CACHE_TTL_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : 300) * 1000;
}

const PUBSUB_CHANNEL = "goal-cache:invalidate";

// ── L1 LRU (Map preserves insertion order for cheap eviction) ────────────────

interface CacheEntry {
  goals: CampaignGoal[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function evictIfNeeded(): void {
  const max = getMaxSize();
  while (cache.size > max) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

// ── Pub/sub wiring ───────────────────────────────────────────────────────────

let _subscriber: import("ioredis").Redis | null = null;
let _publisher: import("ioredis").Redis | null = null;
let _subscribed = false;

async function getRedisClient(
  kind: "subscriber" | "publisher",
): Promise<import("ioredis").Redis> {
  // Lazy import — keeps module load cheap and matches AGENTS.md "Lazy init".
  const { default: Redis } = await import("ioredis");
  const url = process.env.REDIS_URL!;
  if (kind === "subscriber") {
    if (!_subscriber) _subscriber = new Redis(url, { maxRetriesPerRequest: null });
    return _subscriber;
  }
  if (!_publisher) _publisher = new Redis(url, { maxRetriesPerRequest: null });
  return _publisher;
}

/**
 * Subscribe to invalidation messages. Idempotent — calling twice is a no-op.
 * Workers should call this once at startup.
 */
export async function startGoalCacheSubscriber(): Promise<void> {
  if (_subscribed) return;
  const sub = await getRedisClient("subscriber");
  sub.on("message", (channel, message) => {
    if (channel !== PUBSUB_CHANNEL) return;
    if (message === "*") {
      cache.clear();
      logger.debug("goal-cache: invalidated all entries (pub/sub *)");
      return;
    }
    cache.delete(message);
    logger.debug({ campaignId: message }, "goal-cache: invalidated via pub/sub");
  });
  await sub.subscribe(PUBSUB_CHANNEL);
  _subscribed = true;
  logger.info({ channel: PUBSUB_CHANNEL }, "goal-cache: subscriber started");
}

/**
 * Publish an invalidation message. The producer's local LRU is invalidated
 * synchronously here (the pub/sub round-trip is for OTHER workers). Returns
 * after the publish completes (best-effort delivery — no ack).
 */
export async function publishInvalidate(campaignId: string): Promise<void> {
  // Local invalidation first (immediate consistency for the producer worker).
  cache.delete(campaignId);
  try {
    const pub = await getRedisClient("publisher");
    await pub.publish(PUBSUB_CHANNEL, campaignId);
  } catch (err) {
    // Best-effort — local invalidation already happened; remote workers will
    // refresh on TTL.
    logger.warn({ err, campaignId }, "goal-cache: publishInvalidate Redis error");
  }
}

/** Synchronous local invalidation only (no pub/sub broadcast). */
export function invalidate(campaignId: string): void {
  cache.delete(campaignId);
}

/**
 * Load goals for a campaign — cache hit returns immediately, cache miss
 * fetches from Postgres and stores. Only `enabled = true` goals are loaded.
 *
 * Empty results are cached too (no goals = no eval needed; cheap miss is
 * worth caching to avoid hammering the DB on the no-goal common case).
 */
export async function getCachedGoals(
  campaignId: string,
): Promise<CampaignGoal[]> {
  const now = Date.now();
  const cached = cache.get(campaignId);
  if (cached && cached.expiresAt > now) {
    return cached.goals;
  }
  // Miss or expired — refresh.
  const db = getDb();
  const goals = await db
    .select()
    .from(campaignGoals)
    .where(
      and(
        eq(campaignGoals.campaignId, campaignId),
        eq(campaignGoals.enabled, true),
      ),
    );
  // Order by position for predictable iteration (display order, not eval order
  // — but stable iteration helps debugging).
  goals.sort((a, b) => a.position - b.position);
  cache.set(campaignId, { goals, expiresAt: now + getTtlMs() });
  evictIfNeeded();
  return goals;
}

/** Test-only — clears the entire local LRU. */
export function __resetForTests(): void {
  cache.clear();
}

/** Test-only — current cache size (after lazy expiry purge of one key). */
export function __sizeForTests(): number {
  return cache.size;
}
