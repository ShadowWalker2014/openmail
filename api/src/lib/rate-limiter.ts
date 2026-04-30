/**
 * Redis-backed fixed-window rate limiter (CR-05, CN-03).
 *
 * Algorithm: fixed-window counter — NOT token bucket, NOT leaky bucket.
 *   key = `ratelimit:${bucket}:${id}:${windowStart}`  where
 *   windowStart = floor(now / windowMs) * windowMs
 *
 * Atomic INCR + PEXPIRE via a Lua EVAL so the TTL is set exactly once
 * per window (on the first INCR), keeping memory bounded to
 * O(active ids × buckets) — old window keys expire naturally.
 *
 * The previous in-memory `Map` was per-process: with N replicas a client
 * could send N × cap requests/window. This limiter is shared across
 * every API instance that points at the same Redis.
 *
 * Used by:
 *   - api/src/routes/ingest.ts        (per-API-key, default 1000/min)
 *   - api/src/routes/broadcasts.ts    (per-workspace test-send, 5/min)
 */
import Redis from "ioredis";

// ── Lua script (atomic check + auto-expire on first hit) ─────────────────────
// Returns the post-INCR counter value. Setting the TTL only when current == 1
// avoids resetting the window mid-flight on every request.
const FIXED_WINDOW_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return current
`.trim();

// ── Lazy ioredis client (single connection reused across calls) ──────────────
// We use a dedicated client (not bullmq's queue connection) because rate-limit
// EVALs are short-lived and shouldn't share a connection that may be busy
// with bullmq's blocking commands. ioredis is already in the dep tree as a
// transitive dep of bullmq — no new package install needed.
let _client: Redis | null = null;

function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
  };
}

function getClient(): Redis {
  if (_client) return _client;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for rate limiting");
  // maxRetriesPerRequest: 1 — fail fast: a stuck Redis must not stall the
  // request handler. The middleware can fall back to allow-on-failure if it
  // chooses, but the limiter itself surfaces the error.
  _client = new Redis({ ...parseRedisUrl(url), maxRetriesPerRequest: 1, lazyConnect: false });
  return _client;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface RateLimitResult {
  /** True if the call is permitted (counter ≤ limit after INCR). */
  allowed: boolean;
  /** Counter value after this INCR (1-based). */
  current: number;
  /** Milliseconds until the current window ends and the counter resets. */
  resetMs: number;
}

/**
 * Atomic check-and-increment. Compatible with the old in-memory limiter's
 * fixed-window semantics: every call increments the counter; the call is
 * "allowed" iff the post-increment counter is ≤ limit.
 *
 * @param bucket   logical limiter name — e.g. "ingest" or "test-send"
 * @param id       partition key — e.g. an API-key string or a workspace id
 * @param limit    max counter value within the window
 * @param windowMs fixed-window size in milliseconds
 */
export async function rateLimit(
  bucket: string,
  id: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `ratelimit:${bucket}:${id}:${windowStart}`;

  // ioredis types `eval` return as `unknown`; the Lua script always returns a
  // number (the post-INCR counter).
  const current = (await getClient().eval(FIXED_WINDOW_LUA, 1, key, String(windowMs))) as number;

  return {
    allowed: current <= limit,
    current,
    resetMs: windowStart + windowMs - now,
  };
}

/** Test-only: dispose the singleton client so integration tests can clean up. */
export async function __resetRateLimiterForTests(): Promise<void> {
  if (_client) {
    await _client.quit().catch(() => {});
    _client = null;
  }
}
