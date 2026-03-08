import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { segments } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and } from "drizzle-orm";
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
  await db
    .delete(segments)
    .where(and(eq(segments.id, c.req.param("id")), eq(segments.workspaceId, workspaceId)));
  return c.json({ success: true });
});

export default app;
