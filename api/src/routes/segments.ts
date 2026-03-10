import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { segments, contacts, broadcasts, campaigns, events as eventsTable, contactGroups, groups } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and, count, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

// Accept the frontend's human-readable operator names
const conditionOperatorEnum = z.enum([
  "equals", "not_equals", "contains", "not_contains", "is_set", "is_not_set",
  // Also accept legacy short names for backwards compatibility
  "eq", "ne", "gt", "lt", "gte", "lte", "exists", "not_exists",
]);

const segmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  conditions: z.array(z.object({
    field: z.string().min(1),
    operator: conditionOperatorEnum,
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })).min(1),
  conditionLogic: z.enum(["and", "or"]).optional().default("and"),
});

function parsePagination(pageStr?: string, pageSizeStr?: string) {
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(pageSizeStr ?? "50", 10) || 50));
  return { page, pageSize };
}

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  return c.json(
    await db.select().from(segments).where(eq(segments.workspaceId, workspaceId))
  );
});

app.post("/", zValidator("json", segmentSchema), async (c) => {

  const workspaceId = c.get("workspaceId") as string;
  const body = c.req.valid("json");
  const db = getDb();
  const [segment] = await db
    .insert(segments)
    .values({ id: generateId("seg"), workspaceId, ...body })
    .returning();
  return c.json(segment, 201);
});

app.patch(
  "/:id",
  zValidator("json", z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    conditions: z.array(z.object({
      field: z.string().min(1),
      operator: conditionOperatorEnum,
      value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    })).min(1).optional(),
    conditionLogic: z.enum(["and", "or"]).optional(),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const db = getDb();
    const [existing] = await db
      .select()
      .from(segments)
      .where(and(eq(segments.id, c.req.param("id")), eq(segments.workspaceId, workspaceId)))
      .limit(1);
    if (!existing) return c.json({ error: "Not found" }, 404);

    const body = c.req.valid("json");
    const [updated] = await db
      .update(segments)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(segments.id, c.req.param("id")), eq(segments.workspaceId, workspaceId)))
      .returning();
    return c.json(updated);
  }
);

app.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [existing] = await db
    .select()
    .from(segments)
    .where(and(eq(segments.id, c.req.param("id")), eq(segments.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) return c.json({ error: "Not found" }, 404);

  // Guard: refuse deletion if any campaign references this segment as a trigger.
  const [usedByCampaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.workspaceId, workspaceId),
        sql`(${campaigns.triggerConfig}->>'segmentId') = ${existing.id}`
      )
    )
    .limit(1);
  if (usedByCampaign) {
    return c.json({ error: "Cannot delete: segment is referenced by one or more campaigns" }, 400);
  }

  // Guard: refuse deletion if any broadcast includes this segment.
  const [usedByBroadcast] = await db
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(
      and(
        eq(broadcasts.workspaceId, workspaceId),
        sql`${broadcasts.segmentIds} @> ${JSON.stringify([existing.id])}::jsonb`
      )
    )
    .limit(1);
  if (usedByBroadcast) {
    return c.json({ error: "Cannot delete: segment is referenced by one or more broadcasts" }, 400);
  }

  await db
    .delete(segments)
    .where(and(eq(segments.id, c.req.param("id")), eq(segments.workspaceId, workspaceId)));
  return c.json({ success: true });
});

app.get("/:id/people", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { page, pageSize } = parsePagination(c.req.query("page"), c.req.query("pageSize"));
  const db = getDb();

  const [segment] = await db
    .select()
    .from(segments)
    .where(and(eq(segments.id, c.req.param("id")), eq(segments.workspaceId, workspaceId)))
    .limit(1);
  if (!segment) return c.json({ error: "Not found" }, 404);

  const conditions = (segment.conditions as any[]) ?? [];

  /**
   * Build a SQL clause for a single segment condition.
   *
   * Supported field paths:
   *   email, firstName, lastName, phone, unsubscribed
   *   attributes.<key>          → JSONB text extraction
   *   event.<event_name>        → EXISTS subquery in events table
   *   group.<group_type>        → EXISTS subquery in contact_groups + groups
   *
   * Operators:
   *   eq / equals, ne / not_equals
   *   contains, not_contains
   *   exists / is_set, not_exists / is_not_set
   *   gt, lt, gte, lte  (numeric — cast attribute value to numeric)
   */
  function buildClause(cond: { field: string; operator: string; value?: string | number | boolean }): SQL | null {
    const { field, operator: op, value } = cond;

    // ── Event-based conditions ──────────────────────────────────────────────
    // field: "event.<event_name>"
    // is_set / exists → contact has triggered this event at least once
    // not_exists / is_not_set → contact has NEVER triggered this event
    // eq / equals → (same as is_set, for compatibility)
    if (field.startsWith("event.")) {
      const eventName = field.slice("event.".length);
      if (!eventName) return null;
      const hasEvent = sql`EXISTS (
        SELECT 1 FROM events e
        WHERE e.contact_id = ${contacts.id}
          AND e.name = ${eventName}
          AND e.workspace_id = ${workspaceId}
      )`;
      if (op === "exists" || op === "is_set" || op === "eq" || op === "equals") {
        return hasEvent;
      }
      if (op === "not_exists" || op === "is_not_set" || op === "ne" || op === "not_equals") {
        return sql`NOT ${hasEvent}`;
      }
      return null;
    }

    // ── Group membership conditions ─────────────────────────────────────────
    // field: "group.<group_type>"  value: "<group_key>"
    // is_set  → contact is in ANY group of this type
    // eq      → contact is in group with this specific group_key
    // not_exists / ne → negation
    if (field.startsWith("group.")) {
      const groupType = field.slice("group.".length);
      if (!groupType) return null;

      // Base EXISTS subquery: contact is linked to a group of this type
      const inGroupOfType = sql`EXISTS (
        SELECT 1 FROM contact_groups cg
        JOIN groups g ON g.id = cg.group_id
        WHERE cg.contact_id = ${contacts.id}
          AND cg.workspace_id = ${workspaceId}
          AND g.group_type = ${groupType}
          AND g.workspace_id = ${workspaceId}
          ${value !== undefined ? sql`AND g.group_key = ${String(value)}` : sql``}
      )`;

      if (op === "exists" || op === "is_set" || op === "eq" || op === "equals") {
        return inGroupOfType;
      }
      if (op === "not_exists" || op === "is_not_set" || op === "ne" || op === "not_equals") {
        return sql`NOT ${inGroupOfType}`;
      }
      return null;
    }

    // ── Standard contact fields ─────────────────────────────────────────────
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
      return null;
    }

    if (op === "eq" || op === "equals") {
      if (field === "unsubscribed") {
        return sql`${contacts.unsubscribed} = ${value === "true" || value === true}`;
      }
      return sql`lower(${fieldExpr}::text) = lower(${String(value ?? "")})`;
    } else if (op === "ne" || op === "not_equals") {
      if (field === "unsubscribed") {
        return sql`${contacts.unsubscribed} != ${value === "true" || value === true}`;
      }
      return sql`lower(${fieldExpr}::text) != lower(${String(value ?? "")})`;
    } else if (op === "contains") {
      return sql`position(lower(${String(value ?? "")}) in lower(${fieldExpr}::text)) > 0`;
    } else if (op === "not_contains") {
      return sql`position(lower(${String(value ?? "")}) in lower(${fieldExpr}::text)) = 0`;
    } else if (op === "exists" || op === "is_set") {
      if (field.startsWith("attributes.")) {
        const attrKey = field.slice("attributes.".length);
        return sql`(${contacts.attributes}->>${attrKey}) is not null AND (${contacts.attributes}->>${attrKey}) != ''`;
      }
      return sql`${fieldExpr} is not null`;
    } else if (op === "not_exists" || op === "is_not_set") {
      if (field.startsWith("attributes.")) {
        const attrKey = field.slice("attributes.".length);
        return sql`((${contacts.attributes}->>${attrKey}) is null OR (${contacts.attributes}->>${attrKey}) = '')`;
      }
      return sql`${fieldExpr} is null`;
    }
    // ── Numeric comparisons on attributes ──────────────────────────────────
    // Cast the JSONB text value to numeric for comparison
    else if (op === "gt") {
      if (!field.startsWith("attributes.")) return null;
      const attrKey = field.slice("attributes.".length);
      return sql`((${contacts.attributes}->>${attrKey})::numeric > ${Number(value)})`;
    } else if (op === "lt") {
      if (!field.startsWith("attributes.")) return null;
      const attrKey = field.slice("attributes.".length);
      return sql`((${contacts.attributes}->>${attrKey})::numeric < ${Number(value)})`;
    } else if (op === "gte") {
      if (!field.startsWith("attributes.")) return null;
      const attrKey = field.slice("attributes.".length);
      return sql`((${contacts.attributes}->>${attrKey})::numeric >= ${Number(value)})`;
    } else if (op === "lte") {
      if (!field.startsWith("attributes.")) return null;
      const attrKey = field.slice("attributes.".length);
      return sql`((${contacts.attributes}->>${attrKey})::numeric <= ${Number(value)})`;
    }
    return null;
  }

  const clauses = conditions.map(buildClause).filter((c): c is SQL => c !== null);

  const baseCondition = eq(contacts.workspaceId, workspaceId);

  let whereCondition: SQL;
  if (clauses.length === 0) {
    whereCondition = sql`${baseCondition}`;
  } else if (segment.conditionLogic === "or") {
    whereCondition = sql`${baseCondition} AND (${sql.join(clauses, sql` OR `)})`;
  } else {
    whereCondition = sql`${baseCondition} AND (${sql.join(clauses, sql` AND `)})`;
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(contacts)
    .where(sql`${whereCondition}`);

  const data = await db
    .select({
      id: contacts.id,
      email: contacts.email,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      unsubscribed: contacts.unsubscribed,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .where(sql`${whereCondition}`)
    .orderBy(sql`${contacts.createdAt} desc`)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({ data, total, page, pageSize });
});

app.get("/:id/usage", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();

  const [segment] = await db
    .select()
    .from(segments)
    .where(and(eq(segments.id, c.req.param("id")), eq(segments.workspaceId, workspaceId)))
    .limit(1);
  if (!segment) return c.json({ error: "Not found" }, 404);

  const usedCampaigns = await db
    .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status, triggerType: campaigns.triggerType })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.workspaceId, workspaceId),
        sql`(${campaigns.triggerConfig}->>'segmentId') = ${segment.id}`
      )
    );

  const usedBroadcasts = await db
    .select({ id: broadcasts.id, name: broadcasts.name, status: broadcasts.status, subject: broadcasts.subject })
    .from(broadcasts)
    .where(
      and(
        eq(broadcasts.workspaceId, workspaceId),
        sql`${broadcasts.segmentIds} @> ${JSON.stringify([segment.id])}::jsonb`
      )
    );

  return c.json({ campaigns: usedCampaigns, broadcasts: usedBroadcasts });
});

export default app;
