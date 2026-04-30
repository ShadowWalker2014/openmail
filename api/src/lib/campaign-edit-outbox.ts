/**
 * Stage 6 — Campaign edit outbox helper (api side).
 *
 * Tiny wrapper around `INSERT INTO campaign_edit_outbox` so all API edit
 * handlers (step CRUD, goal CRUD, future wait-duration endpoint) write the
 * outbox row in the SAME db.transaction() as the entity mutation.
 *
 * Reject-on-frozen helper: a single source of truth for HTTP 409 on
 * stopping/stopped/archived campaigns ([REQ-28]).
 */
import { sql } from "drizzle-orm";
import type { CampaignEditType } from "@openmail/shared";

export const FROZEN_CAMPAIGN_STATUSES: ReadonlyArray<string> = [
  "stopping",
  "stopped",
  "archived",
];

export function isCampaignFrozen(status: string): boolean {
  return FROZEN_CAMPAIGN_STATUSES.includes(status);
}

export interface OutboxInsert {
  workspaceId: string;
  campaignId: string;
  editType: CampaignEditType;
  details: Record<string, unknown>;
  lifecycleOpId: string;
}

/**
 * Insert an outbox row inside the caller's db transaction (REQUIRED — outbox
 * write must be atomic with the entity write per CR-11).
 */
export async function insertEditOutbox(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  ins: OutboxInsert,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO campaign_edit_outbox
      (workspace_id, campaign_id, edit_type, details, lifecycle_op_id)
    VALUES
      (${ins.workspaceId}, ${ins.campaignId}, ${ins.editType},
       ${JSON.stringify(ins.details)}::jsonb, ${ins.lifecycleOpId})
  `);
}
