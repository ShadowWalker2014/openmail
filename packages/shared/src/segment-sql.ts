/**
 * SQL-native segment condition builder — single source of truth.
 *
 * Used by both:
 *   - api/src/routes/segments.ts (GET /:id/people endpoint)
 *   - worker/src/lib/segment-evaluator.ts (broadcast send, segment-check worker)
 *
 * ALL evaluation is pushed into PostgreSQL — no JavaScript in-memory scan.
 * Scales to millions of contacts with proper index usage:
 *   - event.* conditions → correlated EXISTS with index on events.contact_id
 *   - group.* conditions → correlated EXISTS with index on contact_groups.contact_id
 *   - attributes.* conditions → JSONB ->> operator (add GIN index for large tables)
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { contacts, events, contactGroups, groups } from "./db/schema/index.js";
import type { SegmentCondition } from "./types/index.js";

/**
 * Build a SQL fragment for a single segment condition.
 *
 * The generated SQL assumes the outer query has `contacts` in its FROM clause
 * (correlated subqueries use `contacts.id` to reference the outer row).
 *
 * @returns SQL fragment, or null if the condition is invalid/unsupported.
 */
export function buildConditionClause(
  cond: SegmentCondition,
  workspaceId: string,
): SQL | null {
  const { field, operator: op, value } = cond;

  // ── Event-based conditions ────────────────────────────────────────────────
  // field: "event.<event_name>"
  // Uses a correlated EXISTS subquery against the events table.
  if (field.startsWith("event.")) {
    const eventName = field.slice("event.".length);
    if (!eventName) return null;

    const hasEvent = sql`EXISTS (
      SELECT 1 FROM events ev
      WHERE ev.contact_id = ${contacts.id}
        AND ev.name = ${eventName}
        AND ev.workspace_id = ${workspaceId}
    )`;

    if (op === "exists" || op === "is_set" || op === "eq" || op === "equals") return hasEvent;
    if (op === "not_exists" || op === "is_not_set" || op === "ne" || op === "not_equals") return sql`NOT ${hasEvent}`;
    return null;
  }

  // ── Group membership conditions ───────────────────────────────────────────
  // field: "group.<group_type>"  value: "<group_key>" (optional for is_set)
  if (field.startsWith("group.")) {
    const groupType = field.slice("group.".length);
    if (!groupType) return null;

    const groupKeyFilter = value !== undefined
      ? sql`AND g.group_key = ${String(value)}`
      : sql``;

    const inGroup = sql`EXISTS (
      SELECT 1 FROM contact_groups cg
      JOIN groups g ON g.id = cg.group_id
      WHERE cg.contact_id = ${contacts.id}
        AND cg.workspace_id = ${workspaceId}
        AND g.group_type = ${groupType}
        AND g.workspace_id = ${workspaceId}
        ${groupKeyFilter}
    )`;

    if (op === "exists" || op === "is_set" || op === "eq" || op === "equals") return inGroup;
    if (op === "not_exists" || op === "is_not_set" || op === "ne" || op === "not_equals") return sql`NOT ${inGroup}`;
    return null;
  }

  // ── Standard contact fields ───────────────────────────────────────────────
  let fieldExpr: SQL;
  if (field === "email") {
    fieldExpr = sql`${contacts.email}`;
  } else if (field === "firstName") {
    fieldExpr = sql`${contacts.firstName}`;
  } else if (field === "lastName") {
    fieldExpr = sql`${contacts.lastName}`;
  } else if (field === "phone") {
    fieldExpr = sql`${contacts.phone}`;
  } else if (field === "unsubscribed") {
    fieldExpr = sql`${contacts.unsubscribed}`;
  } else if (field.startsWith("attributes.")) {
    const attrKey = field.slice("attributes.".length);
    if (!attrKey) return null;
    fieldExpr = sql`(${contacts.attributes}->>${attrKey})`;
  } else {
    // Unknown field — log and skip (prevents silent segment broadening if schema changes)
    if (typeof process !== "undefined" && process.env.LOG_LEVEL !== "silent") {
      console.warn(`[segment-sql] Unknown field '${field}' in segment condition — skipping`);
    }
    return null;
  }

  if (op === "eq" || op === "equals") {
    if (field === "unsubscribed") {
      return sql`${contacts.unsubscribed} = ${value === "true" || value === true}`;
    }
    return sql`lower(${fieldExpr}::text) = lower(${String(value ?? "")})`;
  }

  if (op === "ne" || op === "not_equals") {
    if (field === "unsubscribed") {
      return sql`${contacts.unsubscribed} != ${value === "true" || value === true}`;
    }
    return sql`lower(${fieldExpr}::text) != lower(${String(value ?? "")})`;
  }

  if (op === "contains") {
    return sql`position(lower(${String(value ?? "")}) in lower(${fieldExpr}::text)) > 0`;
  }

  if (op === "not_contains") {
    return sql`position(lower(${String(value ?? "")}) in lower(${fieldExpr}::text)) = 0`;
  }

  if (op === "exists" || op === "is_set") {
    if (field.startsWith("attributes.")) {
      const attrKey = field.slice("attributes.".length);
      return sql`(${contacts.attributes}->>${attrKey}) IS NOT NULL AND (${contacts.attributes}->>${attrKey}) != ''`;
    }
    return sql`${fieldExpr} IS NOT NULL`;
  }

  if (op === "not_exists" || op === "is_not_set") {
    if (field.startsWith("attributes.")) {
      const attrKey = field.slice("attributes.".length);
      return sql`((${contacts.attributes}->>${attrKey}) IS NULL OR (${contacts.attributes}->>${attrKey}) = '')`;
    }
    return sql`${fieldExpr} IS NULL`;
  }

  // Numeric comparisons — only valid for attributes.* fields (cast JSONB text to numeric)
  if (op === "gt" || op === "lt" || op === "gte" || op === "lte") {
    if (!field.startsWith("attributes.")) return null;
    const attrKey = field.slice("attributes.".length);
    const numExpr = sql`(${contacts.attributes}->>${attrKey})::numeric`;
    const numVal  = Number(value);
    if (op === "gt")  return sql`${numExpr} > ${numVal}`;
    if (op === "lt")  return sql`${numExpr} < ${numVal}`;
    if (op === "gte") return sql`${numExpr} >= ${numVal}`;
    if (op === "lte") return sql`${numExpr} <= ${numVal}`;
  }

  return null;
}

/**
 * Build a combined SQL WHERE clause for all conditions in one segment.
 *
 * @returns SQL fragment combining all conditions, or null if the segment
 *          has no conditions (meaning: matches ALL contacts).
 */
export function buildSegmentWhereSQL(
  conditions: SegmentCondition[],
  conditionLogic: "and" | "or",
  workspaceId: string,
): SQL | null {
  if (!conditions || conditions.length === 0) return null;

  const clauses = conditions
    .map((c) => buildConditionClause(c, workspaceId))
    .filter((c): c is SQL => c !== null);

  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0];

  const joiner = conditionLogic === "or" ? sql` OR ` : sql` AND `;
  return sql`(${sql.join(clauses, joiner)})`;
}
