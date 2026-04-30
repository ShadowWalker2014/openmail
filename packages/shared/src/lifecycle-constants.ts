/**
 * Lifecycle Constants SSOT (Stage 2 — T2)
 *
 * Numeric bounds + enum value tuples consumed by:
 * - Drizzle CHECK constraints (campaigns.status, campaigns.re_enrollment_policy)
 * - Stage 3 spread-window validation [A3.4]
 * - lifecycle_op_id generation
 *
 * **DO NOT** inline these literals at call sites — single source of truth.
 */

/**
 * Stage 3 [A3.4]: minimum spread window when scheduling resumes/sends.
 * Below 60s = effectively "no spread" — burst protection breaks.
 */
export const SPREAD_WINDOW_MIN_SECONDS = 60;

/**
 * Stage 3 [A3.4]: maximum spread window. 30 days — anything longer is a configuration smell.
 */
export const SPREAD_WINDOW_MAX_SECONDS = 30 * 86400;

/**
 * Re-enrollment policy enum (REQ-08, DB-05).
 * - `never` (default): contact who completed/exited cannot re-enter
 * - `always`: contact re-enters every time trigger fires (caution: repeat sends)
 * - `after_cooldown`: contact may re-enter after `re_enrollment_cooldown_seconds`
 * - `on_attribute_change`: contact re-enters only if attributes changed since last enrollment
 */
export const RE_ENROLLMENT_POLICY_VALUES = [
  "never",
  "always",
  "after_cooldown",
  "on_attribute_change",
] as const;

export type ReEnrollmentPolicy = (typeof RE_ENROLLMENT_POLICY_VALUES)[number];

/**
 * Campaign status enum (REQ-06, DB-02).
 * Stage 2 extends pre-existing enum {draft, active, paused, archived}
 * with two new terminal/transitional states: `stopping`, `stopped`.
 *
 * Existing rows default to `draft` per current schema; no backfill needed.
 *
 * Order is significant — Drizzle CHECK uses this tuple directly.
 */
export const CAMPAIGN_STATUS_VALUES = [
  "draft",
  "active",
  "paused",
  "stopping",
  "stopped",
  "archived",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUS_VALUES)[number];

/**
 * Length of the random portion of `lifecycle_op_id` (CR-15).
 * 12 chars × 36 alphabet = 36^12 ≈ 4.7e18 collisions practically impossible.
 */
export const LIFECYCLE_OP_ID_LENGTH = 12;

/**
 * Stage 4 — per-step pause Redis lock TTL. Default 30s. Override via
 * env `LIFECYCLE_PER_STEP_LOCK_TTL_MS`. The pause endpoint acquires
 * `campaign:lock:step:{stepId}:pause` for this duration to serialize
 * concurrent pause/resume requests against the same step.
 */
export const LIFECYCLE_PER_STEP_LOCK_TTL_MS_DEFAULT = 30_000;
