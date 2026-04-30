/**
 * commit-lifecycle-status (Stage 2 — T9, REQ-11, CR-02, [DB-13]).
 *
 * Typed brand wrapper around `campaigns.status` and `campaign_enrollments.status`
 * mutations. Every transition flows through this single function; combined
 * with the ESLint rule `no-direct-lifecycle-mutation` (T19) and the Postgres
 * trigger `audit_chokepoint_check` (migration 0007), this provides three
 * independent enforcement layers per Approach C v2:
 *
 *   1. **Compile-time**: callers receive `AuditedStatusUpdate<T>` (a brand);
 *      downstream code that requires "audited" cannot accept a raw mutation.
 *   2. **Build-time**: ESLint rule `no-direct-lifecycle-mutation` flags
 *      `db.update(campaigns).set({status: ...})` outside this file.
 *   3. **Run-time**: this function sets `lifecycle.audited_tx = 'true'`; the
 *      Postgres trigger raises `lifecycle.audit_chokepoint` for any UPDATE
 *      not so flagged.
 *
 * The function:
 *   1. Sets the GUC.
 *   2. Reads current status under the caller's tx; throws
 *      `IllegalTransitionError` (HTTP 409 surface) if mismatch with `from`.
 *   3. Executes the UPDATE.
 *   4. Calls `audit.emit(...)` with the matching event_type and a
 *      `{before:{status:from}, after:{status:to}}` delta.
 *   5. Returns an `AuditedStatusUpdate` brand.
 *
 * Per [V2.5], `auditCtx.lifecycleOpId` is required; callers (verb handlers,
 * sweepers) generate at the operation boundary and propagate.
 */

import { sql, eq, type SQL } from "drizzle-orm";
import { campaigns, campaignEnrollments } from "@openmail/shared/schema";
import type { Actor, EnrollmentEventType } from "@openmail/shared";
import { audit, type AuditTx } from "./lifecycle-audit.js";
import { logger } from "./logger.js";

// ────────────────────────────────────────────────────────────────────────────
// Brand type — distinguishes audited vs raw status updates at compile time.
// ────────────────────────────────────────────────────────────────────────────

declare const AuditedBrand: unique symbol;
export type AuditedStatusUpdate<T = unknown> = T & { readonly [AuditedBrand]: true };

// ────────────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────────────

/**
 * Raised when the actual current status does not match the asserted `from`.
 * Map to HTTP 409 with body `{ error: "INVALID_TRANSITION", from, to, actual }`
 * in the Hono route layer.
 */
export class IllegalTransitionError extends Error {
  constructor(
    public readonly entityType: "campaigns" | "campaign_enrollments",
    public readonly entityId: string,
    public readonly expectedFrom: string,
    public readonly attemptedTo: string,
    public readonly actualStatus: string | null,
  ) {
    super(
      `Illegal transition on ${entityType}/${entityId}: ` +
        `expected status="${expectedFrom}", actual="${actualStatus ?? "<missing>"}", attempted to="${attemptedTo}"`,
    );
    this.name = "IllegalTransitionError";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Event type mapping
// ────────────────────────────────────────────────────────────────────────────

/**
 * Maps a target status to the canonical lifecycle event type. Some statuses
 * do not have a unique mapping (e.g. `active` may be `enrolled` or `resumed`
 * depending on origin) — for those, the caller passes `eventTypeOverride`.
 */
function defaultEventTypeFor(
  entityType: "campaigns" | "campaign_enrollments",
  to: string,
): EnrollmentEventType | null {
  // campaigns-level transitions
  if (entityType === "campaigns") {
    switch (to) {
      case "paused":
        return "paused";
      case "active":
        return "resumed";
      case "stopping":
        return "stop_drain_started";
      case "stopped":
        return "drain_completed";
      case "archived":
        return "archived";
      default:
        return null;
    }
  }
  // campaign_enrollments transitions
  switch (to) {
    case "paused":
      return "paused";
    case "active":
      return "resumed";
    default:
      return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Audit context
// ────────────────────────────────────────────────────────────────────────────

export interface CommitAuditCtx {
  /** Always required (CR-15, [V2.5]) — generated at operation boundary. */
  lifecycleOpId: string;
  /** Always required (CR-11) — tagged source of the transition. */
  actor: Actor;
  /** Pre-resolved workspace id for audit row (matches entity's workspace). */
  workspaceId: string;
  /** Required for enrollment-level events; ignored for campaigns. */
  contactId?: string;
  /**
   * Override the event type when the default mapping is ambiguous (e.g. when
   * `active` should be `enrolled` not `resumed`). When omitted, falls back to
   * `defaultEventTypeFor(entityType, to)`.
   */
  eventTypeOverride?: EnrollmentEventType;
  /** Extra payload fields to merge with the boilerplate `lifecycle_op_id`. */
  extraPayload?: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// Inputs
// ────────────────────────────────────────────────────────────────────────────

export type LifecycleEntityType = "campaigns" | "campaign_enrollments";

/** Result of a successful commit. `eventSeq` null for campaign-aggregate events. */
export interface CommitResult {
  entityType: LifecycleEntityType;
  entityId: string;
  from: string;
  to: string;
  eventId: string;
  eventSeq: bigint | null;
}

/**
 * Commit a status transition with full audit guarantees.
 *
 * @param tx          drizzle transaction (REQUIRED — caller owns the tx so the
 *                    UPDATE and audit emit live in the same atomic boundary)
 * @param entityType  `"campaigns"` or `"campaign_enrollments"`
 * @param id          row id of the entity
 * @param from        asserted current status — throws if mismatch
 * @param to          target status
 * @param auditCtx    audit context (op_id, actor, workspace_id, …)
 *
 * @returns a `Branded<CommitResult, 'audited'>` — proves to TypeScript that
 *          this transition was committed via the audited path.
 */
export async function commitLifecycleStatus(
  tx: AuditTx,
  entityType: LifecycleEntityType,
  id: string,
  from: string,
  to: string,
  auditCtx: CommitAuditCtx,
): Promise<AuditedStatusUpdate<CommitResult>> {
  const start = Date.now();

  // 1. Set the GUC so the audit_chokepoint trigger admits the UPDATE.
  await tx.execute(sql`SET LOCAL lifecycle.audited_tx = 'true'`);

  // 2. Read current status under tx + assert.
  const table = entityType === "campaigns" ? campaigns : campaignEnrollments;
  const idCol = entityType === "campaigns" ? campaigns.id : campaignEnrollments.id;
  const statusCol =
    entityType === "campaigns" ? campaigns.status : campaignEnrollments.status;
  const campaignIdCol =
    entityType === "campaigns" ? campaigns.id : campaignEnrollments.campaignId;

  const rows = (await tx
    .select({
      status: statusCol,
      campaignId: campaignIdCol,
    })
    .from(table)
    .where(eq(idCol, id))
    .limit(1)) as Array<{ status: string; campaignId: string }>;
  const current = rows[0];

  if (!current || current.status !== from) {
    throw new IllegalTransitionError(
      entityType,
      id,
      from,
      to,
      current?.status ?? null,
    );
  }

  // 3. Execute the UPDATE.
  const setExpr: Record<string, unknown> = { status: to };
  // updatedAt — both tables carry one. Done via raw SQL to avoid pulling in
  // schema-typed update helpers; transparent to Drizzle.
  await tx.execute(sql`
    UPDATE ${sql.raw(entityType)}
       SET status = ${to}, updated_at = NOW()
     WHERE id = ${id}
  `);
  // setExpr currently unused; keeping for forward compat if callers want extra fields.
  void setExpr;
  void noopRefiner; // keep the helper imported

  // 4. Emit audit event.
  const eventType =
    auditCtx.eventTypeOverride ?? defaultEventTypeFor(entityType, to);
  if (!eventType) {
    throw new Error(
      `commit-lifecycle-status: no default event type for ${entityType} → "${to}". ` +
        `Pass auditCtx.eventTypeOverride.`,
    );
  }

  const isCampaignAggregate = entityType === "campaigns";
  const enrollmentIdForAudit = isCampaignAggregate ? null : id;
  // For campaign-aggregate transitions, contactId is null and event is aggregate.
  // For per-enrollment transitions, contactId comes from the caller (auditCtx).
  const contactIdForAudit = isCampaignAggregate
    ? null
    : auditCtx.contactId ?? null;

  if (!isCampaignAggregate && contactIdForAudit == null) {
    throw new Error(
      `commit-lifecycle-status: enrollment transition requires auditCtx.contactId`,
    );
  }

  const { eventId, eventSeq } = await audit.emit(
    enrollmentIdForAudit,
    eventType,
    {
      campaignId: current.campaignId,
      workspaceId: auditCtx.workspaceId,
      contactId: contactIdForAudit,
      actor: auditCtx.actor,
      payload: {
        lifecycle_op_id: auditCtx.lifecycleOpId,
        ...(auditCtx.extraPayload ?? {}),
      },
      before: { status: from },
      after: { status: to },
    },
    tx,
  );

  logger.info(
    {
      entityType,
      entityId: id,
      from,
      to,
      eventType,
      eventId,
      eventSeq: eventSeq?.toString() ?? null,
      lifecycle_op_id: auditCtx.lifecycleOpId,
      durationMs: Date.now() - start,
    },
    "commit-lifecycle-status",
  );

  const result: CommitResult = {
    entityType,
    entityId: id,
    from,
    to,
    eventId,
    eventSeq,
  };
  return result as AuditedStatusUpdate<CommitResult>;
}

/** No-op type refiner kept for the brand type doc-sites. */
function noopRefiner<T>(x: T): AuditedStatusUpdate<T> {
  return x as AuditedStatusUpdate<T>;
}
// silence "imported but unused" if drizzle's SQL type isn't directly referenced
void (null as unknown as SQL);
