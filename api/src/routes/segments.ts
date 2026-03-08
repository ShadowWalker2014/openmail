import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { segments, contacts, broadcasts, campaigns } from "@openmail/shared/schema";
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

  function buildClause(cond: { field: string; operator: string; value?: string }): SQL | null {
    const { field, operator, value } = cond;

    let fieldExpr: SQL;
    if (field === "email") {
      fieldExpr = sql`${contacts.email}`;
    } else if (field === "firstName") {
      fieldExpr = sql`${contacts.firstName}`;
    } else if (field === "lastName") {
      fieldExpr = sql`${contacts.lastName}`;
    } else if (field === "unsubscribed") {
      fieldExpr = sql`${contacts.unsubscribed}`;
    } else if (field.startsWith("attributes.")) {
      const attrKey = field.slice("attributes.".length);
      if (!attrKey) return null;
      fieldExpr = sql`(${contacts.attributes}->>${attrKey})`;
    } else {
      return null;
    }

    const op = operator;
    if (op === "eq" || op === "equals") {
      if (field === "unsubscribed") {
        return sql`${contacts.unsubscribed} = ${value === "true"}`;
      }
      return sql`lower(${fieldExpr}::text) = lower(${value ?? ""})`;
    } else if (op === "ne" || op === "not_equals") {
      if (field === "unsubscribed") {
        return sql`${contacts.unsubscribed} != ${value === "true"}`;
      }
      return sql`lower(${fieldExpr}::text) != lower(${value ?? ""})`;
    } else if (op === "contains") {
      // Use POSITION instead of LIKE to avoid treating % and _ as wildcards.
      return sql`position(lower(${value ?? ""}) in lower(${fieldExpr}::text)) > 0`;
    } else if (op === "not_contains") {
      return sql`position(lower(${value ?? ""}) in lower(${fieldExpr}::text)) = 0`;
    } else if (op === "exists" || op === "is_set") {
      if (field.startsWith("attributes.")) {
        const attrKey = field.slice("attributes.".length);
        return sql`(${contacts.attributes}->>${attrKey}) is not null`;
      }
      // For nullable columns (firstName, lastName) check IS NOT NULL.
      // Note: email and unsubscribed are NOT NULL — is_set always matches for them.
      return sql`${fieldExpr} is not null`;
    } else if (op === "not_exists" || op === "is_not_set") {
      if (field.startsWith("attributes.")) {
        const attrKey = field.slice("attributes.".length);
        return sql`(${contacts.attributes}->>${attrKey}) is null`;
      }
      return sql`${fieldExpr} is null`;
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
