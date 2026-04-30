/**
 * Lifecycle audit helper (Stage 2 — T8, REQ-10, [DB-03], [A2.18], CR-01).
 *
 * Single chokepoint for emitting `enrollment_events` rows. Every state
 * transition of `campaigns.status` or `campaign_enrollments.status` MUST flow
 * through this helper, in the same transaction as the mutation, so the audit
 * log is the canonical, replayable record (per Approach C v2 — Creative.md).
 *
 * Importable from worker, api, mcp, sdk via `@openmail/shared` for the schema
 * types but the helper itself lives here per [DB-03] decision boundary so
 * callers compose into BullMQ workers without picking up worker-runtime deps
 * in `packages/shared` (kept tree-shakeable for the SDK).
 *
 * Per [V2.5]: callers MUST generate `lifecycle_op_id` (12-char nanoid) at the
 * boundary of an operation (API verb handler, sweeper run, BullMQ job entry)
 * and propagate it through `data.payload.lifecycle_op_id`. This helper does
 * NOT generate op_ids — it validates presence and rejects events without one,
 * which forces the discipline at compile time.
 *
 * Per [V2.9]: `data.before` and `data.after` are delta-only (CN-12). The
 * helper enforces a soft size budget — total mutated keys < 50 — so payload
 * authors can't accidentally pass full row snapshots that blow up storage and
 * Stage 6 replay bandwidth.
 *
 * Event sequencing per [A2.18] (hardened):
 *  - Per-enrollment events: row-lock the parent enrollment, read
 *    MAX(event_seq), INSERT with seq+1.
 *  - On UNIQUE violation (concurrent insert won the race): retry once with a
 *    fresh MAX read. If 2nd attempt also conflicts, throw — caller must
 *    decide retry semantics (BullMQ will retry the job).
 *  - Aggregate events (enrollmentId=NULL): seq=NULL, no lock, direct INSERT.
 */

import { sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";

import { getDb } from "@openmail/shared/db";
import { generateId } from "@openmail/shared/ids";
import type {
  EnrollmentEventType,
  Actor,
} from "@openmail/shared";
import { LIFECYCLE_OP_ID_LENGTH } from "@openmail/shared";
import { logger } from "./logger.js";

// Re-export for callers' typed safety per task spec.
export type { EnrollmentEventType, Actor };

/**
 * Drizzle tx handle when running inside `db.transaction(async tx => …)`.
 * Loose typing — the schema generic resolves to whatever the consumer's
 * `getDb()` instance carries.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AuditTx = PgTransaction<PostgresJsQueryResultHKT, any, ExtractTablesWithRelations<any>>;

/** Raised when the caller forgot to supply `lifecycle_op_id`. */
export class LifecycleAuditMissingOpId extends Error {
  constructor(public readonly eventType: EnrollmentEventType) {
    super(
      `lifecycle-audit: payload.lifecycle_op_id missing for event "${eventType}". ` +
        `Generate a 12-char nanoid at the operation boundary (API verb / sweeper / job entry) and propagate.`,
    );
    this.name = "LifecycleAuditMissingOpId";
  }
}

/** Raised when `before`/`after` deltas exceed the 50-key budget. */
export class LifecycleAuditPayloadTooLarge extends Error {
  constructor(public readonly keyCount: number) {
    super(
      `lifecycle-audit: before/after delta has ${keyCount} keys (max 49). ` +
        `Pass only mutated fields, NOT full row snapshots (CN-12).`,
    );
    this.name = "LifecycleAuditPayloadTooLarge";
  }
}

/**
 * Raised when `event_seq` UNIQUE conflict survives one retry. The caller's
 * BullMQ job (or HTTP handler) decides whether the operation as a whole
 * should retry. We do not retry further inside the helper to keep transaction
 * latency bounded.
 */
export class LifecycleAuditEventSeqConflict extends Error {
  constructor(
    public readonly enrollmentId: string,
    public readonly attemptedSeq: bigint,
  ) {
    super(
      `lifecycle-audit: event_seq UNIQUE conflict on enrollment ${enrollmentId} ` +
        `at seq=${attemptedSeq.toString()} after 2 attempts. Retry the whole operation.`,
    );
    this.name = "LifecycleAuditEventSeqConflict";
  }
}

export interface AuditEmitData {
  campaignId: string;
  workspaceId: string;
  /** NULL for aggregate events (drain_completed, archived, migration_status_change) */
  contactId: string | null;
  actor: Actor;
  /** Free-form payload. MUST contain `lifecycle_op_id: string` (12 chars). */
  payload: Record<string, unknown> & { lifecycle_op_id: string };
  /** Delta-only mutated fields (CN-12). Total keys across before+after < 50. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Override emitted_at (defaults to NOW()); rarely needed. */
  emittedAt?: Date;
  /** Override payload_version (defaults to 1). */
  payloadVersion?: number;
}

export interface AuditEmitResult {
  eventId: string;
  /** NULL for aggregate (campaign-scope) events; bigint for per-enrollment. */
  eventSeq: bigint | null;
}

/** PG SQLSTATE for UNIQUE constraint violation. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Validate `payload.lifecycle_op_id` per [V2.5].
 * 12 chars exact; alphanumeric + dash. We don't enforce the prefix because
 * different services use different prefixes (`lop_api_`, `lop_sweeper_`,
 * `lop_mcp_`) — the 12-char invariant is the random portion only.
 */
function validateOpId(eventType: EnrollmentEventType, payload: AuditEmitData["payload"]): void {
  const opId = payload.lifecycle_op_id;
  if (typeof opId !== "string" || opId.length < LIFECYCLE_OP_ID_LENGTH) {
    throw new LifecycleAuditMissingOpId(eventType);
  }
}

/**
 * Validate delta-only invariant per [V2.9] / CN-12.
 * Soft budget: total mutated keys < 50. Anything more is almost certainly a
 * full row snapshot mistakenly passed.
 */
function validateDeltaSize(before?: Record<string, unknown>, after?: Record<string, unknown>): void {
  const total =
    (before ? Object.keys(before).length : 0) +
    (after ? Object.keys(after).length : 0);
  if (total >= 50) {
    throw new LifecycleAuditPayloadTooLarge(total);
  }
}

/**
 * Emit a lifecycle audit event into `enrollment_events`.
 *
 * @param enrollmentId - per-enrollment event id, OR `null` for aggregate
 * @param eventType    - one of the 18 SSOT event types
 * @param data         - payload + actor + scope identifiers
 * @param tx           - optional existing Drizzle transaction; if absent, helper
 *                       opens its own. Re-using the caller's tx is the normal
 *                       case (commit-lifecycle-status passes its tx through).
 *
 * @throws LifecycleAuditMissingOpId        when `lifecycle_op_id` absent
 * @throws LifecycleAuditPayloadTooLarge    when delta keys ≥ 50
 * @throws LifecycleAuditEventSeqConflict   when 2nd seq attempt also conflicts
 */
export async function emit(
  enrollmentId: string | null,
  eventType: EnrollmentEventType,
  data: AuditEmitData,
  tx?: AuditTx,
): Promise<AuditEmitResult> {
  validateOpId(eventType, data.payload);
  validateDeltaSize(data.before, data.after);

  const start = Date.now();

  // If caller didn't pass a tx, run our own. Either way the body below is
  // identical — both paths set the GUC and INSERT in the same transaction.
  const runWithTx = async (txArg: AuditTx): Promise<AuditEmitResult> => {
    // Pass the audit_chokepoint trigger.
    await txArg.execute(sql`SET LOCAL lifecycle.audited_tx = 'true'`);

    const eventId = generateId("eev");
    const payloadVersion = data.payloadVersion ?? 1;
    // postgres-js with `prepare: false` requires explicit string serialization
    // for timestamp binding (Date object is rejected at the bind stage).
    // Stage 2 R5 fix: serialize to ISO string + cast to timestamptz on insert.
    const emittedAt = (data.emittedAt ?? new Date()).toISOString();

    if (enrollmentId === null) {
      // Aggregate event: event_seq=NULL, contact_id may be NULL too.
      await txArg.execute(sql`
        INSERT INTO enrollment_events (
          id, enrollment_id, campaign_id, contact_id, workspace_id,
          event_type, payload_version, payload, before, after, actor,
          event_seq, emitted_at
        ) VALUES (
          ${eventId},
          NULL,
          ${data.campaignId},
          ${data.contactId},
          ${data.workspaceId},
          ${eventType},
          ${payloadVersion},
          ${JSON.stringify(data.payload)}::jsonb,
          ${data.before ? JSON.stringify(data.before) : null}::jsonb,
          ${data.after ? JSON.stringify(data.after) : null}::jsonb,
          ${JSON.stringify(data.actor)}::jsonb,
          NULL,
          ${emittedAt}
        )
      `);
      logger.debug(
        {
          eventType,
          eventId,
          eventSeq: null,
          enrollmentId: null,
          campaignId: data.campaignId,
          lifecycle_op_id: data.payload.lifecycle_op_id,
          durationMs: Date.now() - start,
        },
        "lifecycle-audit emit (aggregate)",
      );
      return { eventId, eventSeq: null };
    }

    // Per-enrollment event: lock the parent row, read MAX(event_seq)+1, INSERT.
    // FOR UPDATE serializes concurrent emitters for the same enrollment so the
    // common path inserts on the first attempt. UNIQUE constraint is the
    // safety net for the (rare) cross-tx race.
    if (data.contactId == null) {
      // CHECK constraint enrollment_events_contact_required_check would reject
      // this anyway; surface a clearer error here.
      throw new Error(
        `lifecycle-audit: per-enrollment event "${eventType}" requires contactId, got null`,
      );
    }

    await txArg.execute(sql`
      SELECT 1 FROM campaign_enrollments WHERE id = ${enrollmentId} FOR UPDATE
    `);

    const attemptInsert = async (attempt: 1 | 2): Promise<bigint> => {
      const seqRow = await txArg.execute<{ next_seq: string | null }>(sql`
        SELECT COALESCE(MAX(event_seq), 0) + 1 AS next_seq
          FROM enrollment_events
         WHERE enrollment_id = ${enrollmentId}
      `);
      const rawSeq = (seqRow as unknown as Array<{ next_seq: string | number | bigint | null }>)[0]?.next_seq;
      const nextSeq =
        typeof rawSeq === "bigint" ? rawSeq : BigInt(rawSeq ?? 1);

      try {
        await txArg.execute(sql`
          INSERT INTO enrollment_events (
            id, enrollment_id, campaign_id, contact_id, workspace_id,
            event_type, payload_version, payload, before, after, actor,
            event_seq, emitted_at
          ) VALUES (
            ${eventId},
            ${enrollmentId},
            ${data.campaignId},
            ${data.contactId},
            ${data.workspaceId},
            ${eventType},
            ${payloadVersion},
            ${JSON.stringify(data.payload)}::jsonb,
            ${data.before ? JSON.stringify(data.before) : null}::jsonb,
            ${data.after ? JSON.stringify(data.after) : null}::jsonb,
            ${JSON.stringify(data.actor)}::jsonb,
            ${nextSeq},
            ${emittedAt}
          )
        `);
        return nextSeq;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === PG_UNIQUE_VIOLATION) {
          if (attempt === 1) {
            // Single retry with fresh MAX read.
            return attemptInsert(2);
          }
          throw new LifecycleAuditEventSeqConflict(enrollmentId, nextSeq);
        }
        throw err;
      }
    };

    const eventSeq = await attemptInsert(1);

    logger.debug(
      {
        eventType,
        eventId,
        eventSeq: eventSeq.toString(),
        enrollmentId,
        campaignId: data.campaignId,
        lifecycle_op_id: data.payload.lifecycle_op_id,
        durationMs: Date.now() - start,
      },
      "lifecycle-audit emit (per-enrollment)",
    );

    return { eventId, eventSeq };
  };

  if (tx) {
    return runWithTx(tx);
  }
  const db = getDb();
  return db.transaction(runWithTx);
}

/**
 * Namespace export so callers write `audit.emit(...)`. Matches plan T8 prose.
 */
export const audit = {
  emit,
};
