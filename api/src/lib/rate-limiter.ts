/**
 * Redis-backed fixed-window rate limiter.
 *
 * Algorithm — fixed window counter (NOT token bucket, NOT sliding window):
 *   - Key shape: ratelimit:${bucket}:${id}:${windowStart}
 *     where windowStart = floor(now / windowMs) * windowMs.
 *   - Each window has its own key. INCR is atomic; PEXPIRE is set on first
 *     hit so memory bound is O(active workspaces × buckets) and old windows
 *     expire naturally.
 *   - Behavior matches the in-memory map it replaces:
 *       checkLimit(key) { if !entry || expired then reset; if count>=limit return false; count++; return true; }
 *
 * Why fixed window:
 *   - Matches existing semantics → zero behavior change for clients.
 *   - Token bucket allows bursts up to bucket size which would CHANGE behavior.
 *   - Sliding window is more accurate but more complex; not required by CR-05.
 *
 * Atomicity: single Redis EVAL — no read-modify-write race even when 10
 * api replicas hit Redis concurrently.
 */

import { getRedisClient } from "./redis.js";

// Lua: INCR returns new value; on first hit (== 1) we set expiry to windowMs.
// We over-set expiry by 2× windowMs to be safe against clock skew between
// app replicas.
const SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]) * 2)
end
return current
`.trim();

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  resetMs: number;
}

/**
 * Check (and atomically increment) the rate-limit bucket for `id` in `bucket`.
 *
 * @param bucket    short stable identifier of the API surface ("ingest", "test-send", …)
 * @param id        per-actor key (workspaceId, apiKey, etc.)
 * @param limit     max allowed in window (e.g. 1000)
 * @param windowMs  window length in ms (e.g. 60_000)
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

  const redis = getRedisClient();
  const current = (await redis.eval(SCRIPT, 1, key, String(windowMs))) as number;

  return {
    allowed: current <= limit,
    current,
    limit,
    resetMs: windowStart + windowMs - now,
  };
}
