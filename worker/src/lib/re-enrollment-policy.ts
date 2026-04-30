/**
 * Re-enrollment Policy helper (Stage 2 — T10, REQ-15, CR-09, CN-04, [DB-05]).
 *
 * Decides whether a contact may (re-)enroll into a campaign at the moment a
 * trigger fires. Encapsulates the four `re_enrollment_policy` branches:
 *
 *   - `never`               — first-time only (default; preserves pre-Stage-2 behavior)
 *   - `always`              — every trigger fires re-enrollment (caution)
 *   - `after_cooldown`      — allow once `now - prior.completedAt >= cooldown_seconds`
 *   - `on_attribute_change` — allow only when contact attributes hash changed
 *
 * Per CN-04: an active enrollment for (contactId, campaignId) is NEVER blocked
 * here — it returns `{allowed:false, reason:"active_exists"}` so the caller
 * SILENTLY SKIPS (idempotency invariant from Stage 1). That's distinct from a
 * policy denial, which emits `re_enrollment_blocked`.
 *
 * Per [V2.5]: caller MUST generate `lifecycle_op_id` at the operation
 * boundary and pass it in. The helper does not generate one.
 *
 * Audit emission:
 *   - `re_enrolled`           — emitted against `priorEnrollmentId` when policy
 *                               admits a contact who had a prior enrollment.
 *   - `re_enrollment_blocked` — emitted against `priorEnrollmentId` when policy
 *                               denies. Stored as the canonical audit trail of
 *                               the prior enrollment continuing its dormant arc.
 *   - First-time (no prior)   — NO event emitted here; the caller emits the
 *                               regular `enrolled` event after creating the
 *                               new row.
 *   - Active-exists (CN-04)   — NO event emitted; idempotent skip is silent.
 *
 * For `on_attribute_change` we look for an `attributes_hash` field in the
 * prior enrollment's most-recent `enrolled` audit event payload. If absent
 * (e.g. enrollment was created before Stage 2's enrolled-event audit was wired
 * in), we conservatively treat attributes as "changed" and allow re-entry —
 * matches the principle that a missing record should not silently block.
 */

import { createHash } from "node:crypto";
import { sql, and, eq, desc } from "drizzle-orm";
import { campaigns, campaignEnrollments, contacts } from "@openmail/shared/schema";
import { audit, type AuditTx } from "./lifecycle-audit.js";
import { logger } from "./logger.js";

export type ReEnrollmentDecisionReason =
  | "active_exists"
  | "first_time"
  | "policy_never"
  | "policy_always"
  | "cooldown_satisfied"
  | "cooldown_pending"
  | "attributes_changed"
  | "attributes_unchanged";

export interface ReEnrollmentDecision {
  allowed: boolean;
  reason: ReEnrollmentDecisionReason;
  /** Set when the decision was made against an existing prior enrollment. */
  priorEnrollmentId?: string;
}

/**
 * Stable SHA-256 hash over sorted-key JSON. Trivial implementation — sufficient
 * for "did anything change" comparison; not a cryptographic identifier.
 */
export function hashAttributes(attrs: unknown): string {
  if (attrs == null) return createHash("sha256").update("null").digest("hex");
  const stringify = (v: unknown): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stringify).join(",")}]`;
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k])}`).join(",")}}`;
  };
  return createHash("sha256").update(stringify(attrs)).digest("hex");
}

/**
 * Decide whether to allow a (re-)enrollment, emitting audit events on the
 * decision boundary. Caller MUST pass `lifecycleOpId` (12-char nanoid).
 *
 * @param contactId      contact attempting to enter the campaign
 * @param campaignId     target campaign
 * @param tx             Drizzle transaction handle (caller owns it)
 * @param lifecycleOpId  operation correlation id (CR-15, [V2.5])
 * @returns              `{allowed, reason, priorEnrollmentId?}`
 */
export async function shouldAllowEnrollment(
  contactId: string,
  campaignId: string,
  tx: AuditTx,
  lifecycleOpId: string,
): Promise<ReEnrollmentDecision> {
  const start = Date.now();

  // ─── 1. Active-enrollment idempotency check (CN-04) ───
  const activeRows = (await tx
    .select({ id: campaignEnrollments.id })
    .from(campaignEnrollments)
    .where(
      and(
        eq(campaignEnrollments.campaignId, campaignId),
        eq(campaignEnrollments.contactId, contactId),
        eq(campaignEnrollments.status, "active"),
      ),
    )
    .limit(1)) as Array<{ id: string }>;

  if (activeRows.length > 0) {
    return { allowed: false, reason: "active_exists" };
  }

  // ─── 2. Fetch any prior (non-active) enrollment row ───
  const priorRows = (await tx
    .select({
      id: campaignEnrollments.id,
      status: campaignEnrollments.status,
      completedAt: campaignEnrollments.completedAt,
      forceExitedAt: campaignEnrollments.forceExitedAt,
      workspaceId: campaignEnrollments.workspaceId,
    })
    .from(campaignEnrollments)
    .where(
      and(
        eq(campaignEnrollments.campaignId, campaignId),
        eq(campaignEnrollments.contactId, contactId),
      ),
    )
    .orderBy(desc(campaignEnrollments.startedAt))
    .limit(1)) as Array<{
    id: string;
    status: string;
    completedAt: Date | null;
    forceExitedAt: Date | null;
    workspaceId: string;
  }>;

  if (priorRows.length === 0) {
    // First-time: no prior, no audit event from this helper. Caller emits
    // the canonical `enrolled` event after creating the row.
    return { allowed: true, reason: "first_time" };
  }

  const prior = priorRows[0]!;

  // ─── 3. Look up campaign policy + cooldown ───
  const campaignRows = (await tx
    .select({
      reEnrollmentPolicy: campaigns.reEnrollmentPolicy,
      reEnrollmentCooldownSeconds: campaigns.reEnrollmentCooldownSeconds,
      workspaceId: campaigns.workspaceId,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1)) as Array<{
    reEnrollmentPolicy: string;
    reEnrollmentCooldownSeconds: number | null;
    workspaceId: string;
  }>;

  if (campaignRows.length === 0) {
    // Defensive — caller already verified the campaign exists, but if it
    // disappeared mid-tx we err on the side of "do not enroll".
    return { allowed: false, reason: "policy_never", priorEnrollmentId: prior.id };
  }
  const camp = campaignRows[0]!;
  const policy = camp.reEnrollmentPolicy;
  const workspaceId = camp.workspaceId;

  // ─── 4. Apply policy ───
  let decision: ReEnrollmentDecision;

  if (policy === "never") {
    decision = { allowed: false, reason: "policy_never", priorEnrollmentId: prior.id };
  } else if (policy === "always") {
    decision = { allowed: true, reason: "policy_always", priorEnrollmentId: prior.id };
  } else if (policy === "after_cooldown") {
    const cooldownSec = camp.reEnrollmentCooldownSeconds ?? 0;
    // Pick the most recent terminal timestamp available on the prior row.
    const priorEndAt = prior.completedAt ?? prior.forceExitedAt ?? null;
    if (priorEndAt == null) {
      // Prior never reached a terminal timestamp — treat as not yet eligible.
      decision = { allowed: false, reason: "cooldown_pending", priorEnrollmentId: prior.id };
    } else {
      const elapsedSec = Math.floor((Date.now() - priorEndAt.getTime()) / 1000);
      if (elapsedSec >= cooldownSec) {
        decision = { allowed: true, reason: "cooldown_satisfied", priorEnrollmentId: prior.id };
      } else {
        decision = { allowed: false, reason: "cooldown_pending", priorEnrollmentId: prior.id };
      }
    }
  } else if (policy === "on_attribute_change") {
    // Compute current attributes hash.
    const contactRows = (await tx
      .select({ attributes: contacts.attributes })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1)) as Array<{ attributes: unknown }>;
    const currentHash = hashAttributes(contactRows[0]?.attributes ?? null);

    // Look up prior `enrolled` event payload.attributes_hash, if any.
    const priorHashRows = (await tx.execute<{ attributes_hash: string | null }>(
      sql`
        SELECT payload ->> 'attributes_hash' AS attributes_hash
          FROM enrollment_events
         WHERE enrollment_id = ${prior.id}
           AND event_type = 'enrolled'
         ORDER BY emitted_at DESC
         LIMIT 1
      `,
    )) as unknown as Array<{ attributes_hash: string | null }>;

    const priorHash = priorHashRows[0]?.attributes_hash ?? null;
    if (priorHash == null || priorHash !== currentHash) {
      decision = {
        allowed: true,
        reason: "attributes_changed",
        priorEnrollmentId: prior.id,
      };
    } else {
      decision = {
        allowed: false,
        reason: "attributes_unchanged",
        priorEnrollmentId: prior.id,
      };
    }
  } else {
    // Unknown policy value — fail closed.
    decision = { allowed: false, reason: "policy_never", priorEnrollmentId: prior.id };
  }

  // ─── 5. Emit audit event for the decision (against prior enrollment id) ───
  const eventType = decision.allowed ? "re_enrolled" : "re_enrollment_blocked";
  await audit.emit(
    prior.id,
    eventType,
    {
      campaignId,
      workspaceId,
      contactId,
      actor: { kind: "system" },
      payload: {
        lifecycle_op_id: lifecycleOpId,
        policy,
        reason: decision.reason,
      },
    },
    tx,
  );

  logger.info(
    {
      contactId,
      campaignId,
      policy,
      decision,
      lifecycle_op_id: lifecycleOpId,
      durationMs: Date.now() - start,
    },
    "re-enrollment-policy decision",
  );

  return decision;
}
