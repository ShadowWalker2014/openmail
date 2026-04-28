/**
 * Redis-backed rate-limiter integration test (T12).
 *
 * Verifies:
 *   - Direct rateLimit() function: 1000th allowed, 1001st rejected
 *   - Reset after window expires
 *   - Per-bucket isolation (ingest vs test-send buckets are independent)
 *   - Per-id isolation (two workspaces have independent counters)
 *   - Two ioredis clients (simulating multi-replica) share the SAME bucket
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { setTestEnv, startContainers, stopContainers, waitForDb, waitForRedis, runMigrations, flushRedis, TEST_DB_URL } from "./_fixtures.js";
import postgres from "postgres";

setTestEnv();

let rawDb: postgres.Sql;

beforeAll(async () => {
  await startContainers();
  await waitForDb();
  await waitForRedis();
  rawDb = postgres(TEST_DB_URL, { max: 2 });
  await runMigrations(rawDb);
}, 180_000);

afterAll(async () => {
  await rawDb?.end({ timeout: 5 }).catch(() => {});
  await stopContainers();
}, 30_000);

beforeEach(async () => {
  await flushRedis();
});

describe("rate-limiter (T12)", () => {
  it("first 1000 calls allowed, 1001st rejected", async () => {
    const { rateLimit } = await import("../lib/rate-limiter.js");
    const id = "ws_test_1k";

    // 1000 in burst
    const results = await Promise.all(
      Array.from({ length: 1000 }, () => rateLimit("ingest", id, 1000, 60_000)),
    );
    expect(results.every((r) => r.allowed)).toBe(true);

    // 1001st rejected
    const overflow = await rateLimit("ingest", id, 1000, 60_000);
    expect(overflow.allowed).toBe(false);
    expect(overflow.current).toBe(1001);
    expect(overflow.resetMs).toBeGreaterThan(0);
  });

  it("two workspaces have independent buckets", async () => {
    const { rateLimit } = await import("../lib/rate-limiter.js");
    const wsA = "ws_a";
    const wsB = "ws_b";

    // Burn wsA's quota with limit=2
    expect((await rateLimit("ingest", wsA, 2, 60_000)).allowed).toBe(true);
    expect((await rateLimit("ingest", wsA, 2, 60_000)).allowed).toBe(true);
    expect((await rateLimit("ingest", wsA, 2, 60_000)).allowed).toBe(false);

    // wsB should still be fresh
    expect((await rateLimit("ingest", wsB, 2, 60_000)).allowed).toBe(true);
  });

  it("two buckets (ingest vs test-send) for same id are independent", async () => {
    const { rateLimit } = await import("../lib/rate-limiter.js");
    const id = "ws_split";

    expect((await rateLimit("ingest", id, 2, 60_000)).allowed).toBe(true);
    expect((await rateLimit("ingest", id, 2, 60_000)).allowed).toBe(true);
    expect((await rateLimit("ingest", id, 2, 60_000)).allowed).toBe(false);

    // test-send bucket — fresh
    expect((await rateLimit("test-send", id, 2, 60_000)).allowed).toBe(true);
  });

  it("counter resets in the next window", async () => {
    const { rateLimit } = await import("../lib/rate-limiter.js");
    const id = "ws_reset";

    // Use 200ms window for fast test
    expect((await rateLimit("ingest", id, 1, 200)).allowed).toBe(true);
    expect((await rateLimit("ingest", id, 1, 200)).allowed).toBe(false);

    // Wait for next window
    await Bun.sleep(250);

    expect((await rateLimit("ingest", id, 1, 200)).allowed).toBe(true);
  });

  it("two ioredis clients (simulated multi-replica) share the same bucket", async () => {
    // The rateLimit() function uses a singleton client; simulate "another replica"
    // by creating a parallel ioredis client and verifying it sees the same key.
    const IORedis = (await import("ioredis")).default;
    const cfg = new URL(process.env.REDIS_URL!);
    const directClient = new IORedis({ host: cfg.hostname, port: Number(cfg.port) });

    const { rateLimit } = await import("../lib/rate-limiter.js");
    const id = "ws_multi_replica";

    // Replica 1 — burn 5 hits
    for (let i = 0; i < 5; i++) {
      await rateLimit("ingest", id, 10, 60_000);
    }

    // Replica 2 (direct client) sees the same key
    const now = Date.now();
    const windowStart = Math.floor(now / 60_000) * 60_000;
    const key = `ratelimit:ingest:${id}:${windowStart}`;
    const value = await directClient.get(key);
    expect(Number(value)).toBe(5);

    await directClient.quit();
  });
});
