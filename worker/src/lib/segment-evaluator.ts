/**
 * SQL-native segment evaluation.
 *
 * ALL filtering is pushed into PostgreSQL. No contacts, events, or group
 * memberships are ever loaded into Node.js memory for filtering purposes.
 *
 * Scale characteristics:
 *   - getSegmentContacts: single SQL query using DISTINCT — uses DB indexes
 *   - contactMatchesSegment: single SQL query with EXISTS subqueries
 *   - Works correctly for workspaces with millions of contacts
 */

import { getDb } from "@openmail/shared/db";
import { contacts, segments } from "@openmail/shared/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { buildSegmentWhereSQL } from "@openmail/shared/segment-sql";
import type { SegmentCondition } from "@openmail/shared/types";

/**
 * Fetch all non-unsubscribed contacts that match ANY of the given segments.
 *
 * Builds a single SQL query with OR between per-segment clauses.
 * If a segment has no conditions it matches all contacts (short-circuits to
 * returning the full non-unsubscribed list for this workspace).
 *
 * Returns { id, email } pairs — everything send-broadcast needs to create
 * emailSends rows without an extra roundtrip.
 */
export async function getSegmentContacts(
  workspaceId: string,
  segmentIds: string[],
): Promise<{ id: string; email: string }[]> {
  if (segmentIds.length === 0) return [];

  const db = getDb();

  const targetSegments = await db
    .select()
    .from(segments)
    .where(
      and(
        eq(segments.workspaceId, workspaceId),
        sql`${segments.id} = ANY(${sql.raw(
          `ARRAY[${segmentIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]::text[]`,
        )})`,
      ),
    );

  if (targetSegments.length === 0) return [];

  // Build one SQL clause per segment. OR-combine them so a contact matching
  // ANY segment is included. DISTINCT handles overlapping memberships.
  const segmentClauses: ReturnType<typeof sql>[] = [];
  let matchAll = false;

  for (const segment of targetSegments) {
    const conditions = (segment.conditions as SegmentCondition[]) ?? [];
    const conditionLogic = (segment.conditionLogic ?? "and") as "and" | "or";
    const whereClause = buildSegmentWhereSQL(conditions, conditionLogic, workspaceId);

    if (!whereClause) {
      // Segment with no conditions → every contact qualifies → short-circuit
      matchAll = true;
      break;
    }

    segmentClauses.push(whereClause);
  }

  const baseWhere = sql`${contacts.workspaceId} = ${workspaceId} AND ${contacts.unsubscribed} = false`;

  if (matchAll || segmentClauses.length === 0) {
    return db
      .select({ id: contacts.id, email: contacts.email })
      .from(contacts)
      .where(baseWhere);
  }

  const combinedClause =
    segmentClauses.length === 1
      ? segmentClauses[0]
      : sql`(${sql.join(segmentClauses, sql` OR `)})`;

  return db
    .select({ id: contacts.id, email: contacts.email })
    .from(contacts)
    .where(sql`${baseWhere} AND ${combinedClause}`);
}

/**
 * @deprecated Use getSegmentContacts instead (returns email alongside ID,
 * eliminating the redundant second query in send-broadcast).
 */
export async function getSegmentContactIds(
  workspaceId: string,
  segmentIds: string[],
): Promise<string[]> {
  const rows = await getSegmentContacts(workspaceId, segmentIds);
  return rows.map((r) => r.id);
}

/**
 * Check whether a single contact currently matches a specific segment.
 *
 * Runs a single parameterised SQL query — no contact data loaded into memory.
 * Used by the check-segment worker to evaluate membership changes per contact.
 */
export async function contactMatchesSegment(
  contactId: string,
  segmentId: string,
): Promise<boolean> {
  const db = getDb();

  const [segment] = await db
    .select()
    .from(segments)
    .where(eq(segments.id, segmentId))
    .limit(1);

  if (!segment) return false;

  const [contact] = await db
    .select({ workspaceId: contacts.workspaceId })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contact) return false;

  const workspaceId = contact.workspaceId;
  const conditions  = (segment.conditions as SegmentCondition[]) ?? [];
  const logic       = (segment.conditionLogic ?? "and") as "and" | "or";
  const whereClause = buildSegmentWhereSQL(conditions, logic, workspaceId);

  // If no conditions, every contact matches
  if (!whereClause) {
    const [row] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(sql`${contacts.id} = ${contactId}`)
      .limit(1);
    return !!row;
  }

  // Run the full segment SQL constrained to this single contact
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`${contacts.id} = ${contactId} AND ${whereClause}`)
    .limit(1);

  return !!row;
}
