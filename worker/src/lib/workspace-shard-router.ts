/**
 * Workspace shard router (Stage 5 — T4, [A5.2]).
 *
 * Forward-compatible plumbing for multi-tenant cache locality. The Stage 5
 * goal-cache (Task 6) keeps a per-worker LRU keyed by campaignId; in a single
 * shard deployment every worker may end up with a copy of the same campaign's
 * goals (cache duplication is fine but wastes RAM at the 10k+ campaigns × N
 * workers scale that [A5.2] anticipates).
 *
 * Ultimate target: `workspaceId → shard` mapping that lets a campaign's job
 * always land on the worker that already cached its goals (≥95% hit ratio per
 * Stage 5 PRD CR-09).
 *
 * **Today's behavior** (LIFECYCLE_WORKSPACE_SHARD_COUNT defaults to 1):
 * - `getShardId` always returns 0
 * - `getShardedQueueName` returns `baseQueueName` unchanged
 * - No queue infrastructure changes — Stage 1's worker registry untouched
 *
 * **Future scaling path** (env-var flip; no code change required for callers):
 * - Set `LIFECYCLE_WORKSPACE_SHARD_COUNT=N` (must equal worker replica count)
 * - Workers read their `WORKER_SHARD_INDEX` and only consume from
 *   `{queue}-shard-{ownIndex}`
 * - Producers route via `getShardedQueueName(queue, workspaceId)`
 *
 * The actual sharded-queue infrastructure (Worker registration with shard
 * filter, shard rebalancing on scale events, etc.) is out of scope for
 * Stage 5 — this file only ships the routing primitive so callers can
 * compose against it without later refactoring their call sites.
 *
 * @see PRPs/sota-lifecycle-engine/02-prd-stage-5-goal-exits.md [A5.2]
 */

/**
 * Default shard count when env var is unset or invalid.
 * 1 = sharding disabled (single-tenant or pre-scale deployments).
 */
const DEFAULT_SHARD_COUNT = 1;

/**
 * FNV-1a 32-bit hash. Deterministic, no crypto-strength needed (we just need
 * even distribution across shards). Avoids dragging in Node's `crypto`.
 *
 * Same `workspaceId` always maps to same shard across worker replicas, which
 * is the whole point — locality.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply by FNV prime (16777619), mod 2^32
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Read the configured shard count. Lazy env-var read per AGENTS.md "Lazy init
 * all services". Returns ≥1 always (clamps invalid values to default).
 */
export function getShardCount(): number {
  const raw = process.env.LIFECYCLE_WORKSPACE_SHARD_COUNT;
  if (!raw) return DEFAULT_SHARD_COUNT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SHARD_COUNT;
  return parsed;
}

/**
 * Compute the shard id for a workspace. Range: `[0, shardCount)`.
 * Deterministic; same `workspaceId` always produces same id within a deployment.
 */
export function getShardId(workspaceId: string): number {
  const count = getShardCount();
  if (count === 1) return 0;
  return fnv1a32(workspaceId) % count;
}

/**
 * Resolve the queue name for a (queue, workspace) pair.
 *
 * - When `LIFECYCLE_WORKSPACE_SHARD_COUNT=1` (default): returns `baseQueueName`
 *   unchanged. Callers can adopt this routing helper today without altering
 *   queue infrastructure.
 * - When `LIFECYCLE_WORKSPACE_SHARD_COUNT=N`: returns
 *   `{baseQueueName}-shard-{shardId}` so producer + consumer remain aligned.
 *
 * Sharding is opt-in at the deployment level. Workers that don't yet
 * understand sharded queues will simply not pick up the sharded jobs — the
 * env var must only be flipped after the consumer side is provisioned.
 */
export function getShardedQueueName(
  baseQueueName: string,
  workspaceId: string,
): string {
  const count = getShardCount();
  if (count === 1) return baseQueueName;
  const shardId = getShardId(workspaceId);
  return `${baseQueueName}-shard-${shardId}`;
}

/** True iff sharding is enabled in this process. */
export function isShardingEnabled(): boolean {
  return getShardCount() > 1;
}
