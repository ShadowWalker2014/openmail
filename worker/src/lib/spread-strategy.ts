/**
 * Spread strategy library (Stage 3 — T3, REQ-10, CR-01, CN-01).
 *
 * Pure helper that converts a stream/iterator of overdue enrollments into a
 * stream of (enrollmentId, delay_ms) tuples. Generator-based so the caller
 * can pipe enrollments from a Postgres cursor without ever materialising the
 * full set in memory (CN-01).
 *
 * Algorithm:
 *   step_ms = max(window_ms / total, 1000 / rate_limit_per_sec)
 *
 * The `max(...)` clause realises the rate-limiter floor (CR-01): when the
 * operator picks a too-aggressive window relative to the workspace's send
 * rate cap, the rate limiter dictates the spacing and the spread effectively
 * extends beyond the chosen window — the safety mechanisms compose, never
 * conflict.
 *
 * Sort order:
 *  - `fifo_by_original_time` — sort by `scheduledAt` (or `next_run_at` ASC)
 *    BEFORE iterating so the contact who has been waiting the longest sends
 *    first. Customer.io pattern; intuitive operator mental model [DB-01].
 *  - `fifo_by_resume_time` — preserve cursor order; whatever the DB returns
 *    is the order. Useful when the DB cursor is itself ordered by enrolment
 *    id (proxy for "newest paused first").
 *
 * The sort decision is made by the caller — this helper only knows how to
 * compute delays once the input is in iteration order. The caller streams
 * pre-sorted enrollments via Postgres `ORDER BY` clause when
 * `fifo_by_original_time` is requested.
 */

export type SpreadStrategy =
  | "fifo_by_original_time"
  | "fifo_by_resume_time";

export interface SpreadOpts {
  /** Total spread window in seconds. Floor is the workspace rate-limit cap. */
  spreadWindowSeconds: number;
  /** Workspace rate-limiter cap, sends/sec. Used as floor (CR-01). */
  rateLimitPerSec: number;
  /** Total count of enrollments — required up front for step_ms compute. */
  total: number;
  /** Strategy is captured for logging — the caller is responsible for sort. */
  strategy: SpreadStrategy;
}

export interface SpreadInput {
  enrollmentId: string;
  /** Original scheduledAt or next_run_at; included for audit trail emit. */
  scheduledAt?: Date | null;
}

export interface SpreadOutput {
  enrollmentId: string;
  delayMs: number;
  /** 0-based offset within the spread sequence. */
  offset: number;
  /** Original scheduledAt forwarded for audit emit. */
  scheduledAt: Date | null;
}

/**
 * Compute step_ms for the given window + total + rate-limit cap.
 *
 * Pure exported so unit tests can verify the floor behavior.
 */
export function computeStepMs(opts: {
  spreadWindowSeconds: number;
  rateLimitPerSec: number;
  total: number;
}): number {
  const windowMs = opts.spreadWindowSeconds * 1000;
  const total = Math.max(1, opts.total);
  const naive = Math.floor(windowMs / total);
  // Rate-limit floor: 1 send per (1000 / rate_limit_per_sec) ms.
  const rateLimitFloor = Math.ceil(1000 / Math.max(0.001, opts.rateLimitPerSec));
  return Math.max(naive, rateLimitFloor);
}

/**
 * Stream-yield delays for each input enrollment. The caller is responsible
 * for pre-sorting the input iterator per strategy (fifo_by_original_time
 * sorts via the SQL `ORDER BY scheduled_at ASC`; fifo_by_resume_time uses
 * the cursor's natural order).
 *
 * Memory: O(1) — no array buffering. The generator yields one tuple per
 * upstream `next()`. Suitable for piping a Postgres cursor of any size.
 */
export function* computeSpreadSchedule(
  enrollments: Iterable<SpreadInput>,
  opts: SpreadOpts,
): Generator<SpreadOutput, void, unknown> {
  const stepMs = computeStepMs({
    spreadWindowSeconds: opts.spreadWindowSeconds,
    rateLimitPerSec: opts.rateLimitPerSec,
    total: opts.total,
  });

  let offset = 0;
  for (const enr of enrollments) {
    const delayMs = offset * stepMs;
    yield {
      enrollmentId: enr.enrollmentId,
      delayMs,
      offset,
      scheduledAt: enr.scheduledAt ?? null,
    };
    offset += 1;
  }
}

/**
 * Async generator variant — useful when the input is itself async (e.g. a
 * Postgres cursor that pages over rows). The semantics match the sync
 * version exactly.
 */
export async function* computeSpreadScheduleAsync(
  enrollments: AsyncIterable<SpreadInput>,
  opts: SpreadOpts,
): AsyncGenerator<SpreadOutput, void, unknown> {
  const stepMs = computeStepMs({
    spreadWindowSeconds: opts.spreadWindowSeconds,
    rateLimitPerSec: opts.rateLimitPerSec,
    total: opts.total,
  });

  let offset = 0;
  for await (const enr of enrollments) {
    const delayMs = offset * stepMs;
    yield {
      enrollmentId: enr.enrollmentId,
      delayMs,
      offset,
      scheduledAt: enr.scheduledAt ?? null,
    };
    offset += 1;
  }
}
