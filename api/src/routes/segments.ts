import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { segments } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  return c.json(await db.select().from(segments).where(eq(segments.workspaceId, workspaceId)));
});

app.post(
  "/",
  zValidator("json", z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    conditions: z.array(z.object({
      field: z.string(),
      operator: z.enum(["eq", "ne", "gt", "lt", "gte", "lte", "contains", "not_contains", "exists", "not_exists"]),
      value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    })),
    conditionLogic: z.enum(["and", "or"]).optional().default("and"),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const body = c.req.valid("json");
    const db = getDb();
    const [segment] = await db.insert(segments).values({ id: generateId("seg"), workspaceId, ...body }).returning();
    return c.json(segment, 201);
  }
);

export default app;
