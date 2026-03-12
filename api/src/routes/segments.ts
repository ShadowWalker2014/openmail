import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { segments, contacts, broadcasts, campaigns } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { buildConditionClause, buildSegmentWhereSQL } from "@openmail/shared/segment-sql";
import { eq, and, count, sql, desc } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

// Accept the frontend's human-readable operator names
const conditionOperatorEnum = z.enum([
  "equals", "not_equals", "contains", "not_contains", "is_set", "is_not_set",
  // Also accept legacy short names for backwards compatibility
  "eq", "ne", "gt", "lt", "gte", "lte", "exists", "not_exists",
]);

const segmentConditionValueSchema = z.union([z.string().max(500), z.number(), z.boolean()]).optional();

const segmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  conditions: z.array(z.object({
    field: z.string().min(1),
    operator: conditionOperatorEnum,
    value: segmentConditionValueSchema,
  })).min(1),
  conditionLogic: z.enum(["and", "or"]).optional().default("and"),
});

function parsePagination(pageStr?: string, pageSizeStr?: string) {
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr ?? "50", 10) || 50));
  return { page, pageSize };
}

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { page, pageSize } = parsePagination(c.req.query("page"), c.req.query("pageSize"));
  const db = getDb();
  const [{ total }] = await db.select({ total: count() }).from(segments).where(eq(segments.workspaceId, workspaceId));
  const data = await db
    .select()
    .from(segments)
    .where(eq(segments.workspaceId, workspaceId))
    .orderBy(desc(segments.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return c.json({ data, total, page, pageSize });
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
      value: segmentConditionValueSchema,
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
  const conditionLogic = (segment.conditionLogic ?? "and") as "and" | "or";

  // Use the shared SQL builder — single source of truth with the worker.
  const segmentWhere = buildSegmentWhereSQL(conditions, conditionLogic, workspaceId);
  const baseCondition = eq(contacts.workspaceId, workspaceId);

  const whereCondition: SQL = segmentWhere
    ? sql`${baseCondition} AND ${segmentWhere}`
    : sql`${baseCondition}`;

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
