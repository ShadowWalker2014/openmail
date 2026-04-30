/**
 * Audited migration helper (Stage 2 — T7a, [V2.6], [A2.20], CN-10).
 *
 * Wrapper for migration scripts that intentionally mutate `campaigns.status`
 * or `campaign_enrollments.status` outside the normal worker/API flow.
 *
 * **Why this exists.** Round 5 of Stage 2 installs a Postgres trigger
 * (`audit_chokepoint_check`, migration 0007) that BLOCKS any UPDATE OF status
 * unless the transaction has set `lifecycle.audited_tx = 'true'`. Without this
 * helper, future migrations that need to reclassify campaigns (e.g. a backfill
 * to set `re_enrollment_policy` based on existing rows, or a one-off "stop all
 * draft campaigns from before X" cleanup) would either:
 *  - bypass auditing silently (drift), OR
 *  - throw `lifecycle.audit_chokepoint` and halt the migration.
 *
 * This helper provides the explicit, traceable bypass: set the GUC AND emit a
 * `migration_status_change` row with full provenance per [A2.20] (actor.kind =
 * 'migration', payload.migrationName, affected_count, etc.). Auditors can then
 * answer "who changed status of campaign X to Y?" by querying enrollment_events
 * with `actor->>'kind' = 'migration'`.
 *
 * Usage:
 * ```ts
 * import { auditedMigration } from "@openmail/shared/db";
 * await auditedMigration(
 *   {
 *     migrationName: "0010_normalize_legacy_paused_to_stopped",
 *     campaignId: "*",                                   // bulk
 *     payload: { affected_count: 42, reason: "..." },
 *     actorName: "ops/2026-04-30/relishev",
 *   },
 *   async (tx) => {
 *     // Now the GUC is set; mutations on campaigns.status are audited.
 *     await tx.execute(sql`UPDATE campaigns SET status = 'stopped' WHERE ...`);
 *   },
 * );
 * ```
 *
 * **Invariants.**
 * - Wraps the entire body in a single transaction.
 * - Sets `SET LOCAL lifecycle.audited_tx = 'true'` BEFORE running the body
 *   (so the body's status mutations pass the trigger).
 * - INSERTs an aggregate `migration_status_change` row in `enrollment_events`
 *   per [A2.20]: `enrollment_id=NULL`, `contact_id=NULL`, `event_seq=NULL`.
 *   `campaign_id` may be a real id OR the literal string `'*'` for bulk.
 * - The body callback receives the transaction handle. Its return value is
 *   forwarded as the helper's return value.
 * - On any error inside the body, the entire transaction rolls back — the
 *   `migration_status_change` row is rolled back too. This is the right
 *   behaviour: if the migration didn't actually mutate anything, we don't
 *   want a phantom audit row claiming it did.
 */

import { sql } from "drizzle-orm";
import { getDb } from "../client.js";
import { generateId } from "../../ids.js";
import type { EnrollmentEventType } from "../../lifecycle-events.js";

const MIGRATION_EVENT: EnrollmentEventType = "migration_status_change";

export interface AuditedMigrationParams {
  /** Stable identifier — usually the migration filename without extension. */
  migrationName: string;
  /**
   * Campaign id this migration affects, OR the literal `'*'` for bulk
   * migrations that touch many campaigns. (`campaigns.id` does not have an
   * FK in `enrollment_events` — `'*'` is just a sentinel string.)
   */
  campaignId: string;
  /**
   * Workspace id. For bulk migrations that span workspaces, use `'*'`.
   * Required because `enrollment_events.workspace_id` is NOT NULL.
   */
  workspaceId: string;
  /**
   * Free-form payload. Required keys per [A2.20]:
   *  - `affected_count`: number — how many rows the migration intends to mutate
   *  - `reason`: string — human-readable rationale
   * Optional:
   *  - `dry_run_diff`: object — for rehearsals / postgres-side previews
   *  - any other migration-specific fields
   */
  payload: {
    affected_count: number;
    reason: string;
    dry_run_diff?: unknown;
    [k: string]: unknown;
  };
  /**
   * Identifies the human/script that ran the migration. Goes into
   * `actor.name`. Suggested format: `<who>/<date>/<reason>` e.g.
   * `"ops/2026-04-30/relishev"` or `"ci/0010_normalize_legacy_paused"`.
   */
  actorName: string;
}

/**
 * Wraps `body` in a transaction with `lifecycle.audited_tx = 'true'` set, and
 * emits a `migration_status_change` row before running the body so a partial
 * failure still leaves the migration intent recorded (within the same tx that
 * rolls back if `body` throws).
 *
 * @returns the value returned by `body`.
 */
export async function auditedMigration<T>(
  params: AuditedMigrationParams,
  body: (tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // 1. Set the GUC for this transaction so the audit_chokepoint trigger
    //    permits status UPDATEs that follow.
    await tx.execute(sql`SET LOCAL lifecycle.audited_tx = 'true'`);

    // 2. Emit the migration_status_change row (aggregate event per [A2.20]):
    //    enrollment_id = NULL, contact_id = NULL, event_seq = NULL.
    const eventId = generateId("eev");
    await tx.execute(sql`
      INSERT INTO enrollment_events (
        id,
        enrollment_id,
        campaign_id,
        contact_id,
        workspace_id,
        event_type,
        payload_version,
        payload,
        actor,
        event_seq,
        emitted_at
      ) VALUES (
        ${eventId},
        NULL,
        ${params.campaignId},
        NULL,
        ${params.workspaceId},
        ${MIGRATION_EVENT},
        1,
        ${JSON.stringify({
          migrationName: params.migrationName,
          ...params.payload,
        })}::jsonb,
        ${JSON.stringify({ kind: "migration", name: params.actorName })}::jsonb,
        NULL,
        NOW()
      )
    `);

    // 3. Run the caller's mutation body inside the same tx.
    return body(tx);
  });
}
