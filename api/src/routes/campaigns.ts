import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { campaigns, campaignSteps } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  return c.json(await db.select().from(campaigns).where(eq(campaigns.workspaceId, workspaceId)));
});

app.get("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId)))
    .limit(1);
  if (!campaign) return c.json({ error: "Not found" }, 404);
  const steps = await db.select().from(campaignSteps).where(eq(campaignSteps.campaignId, campaign.id));
  return c.json({ ...campaign, steps });
});

app.post(
  "/",
  zValidator("json", z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    triggerType: z.enum(["event", "segment_enter", "segment_exit", "manual"]),
    triggerConfig: z.record(z.unknown()).optional().default({}),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const body = c.req.valid("json");
    const db = getDb();
    const [campaign] = await db.insert(campaigns).values({ id: generateId("cmp"), workspaceId, ...body }).returning();
    return c.json(campaign, 201);
  }
);

app.patch(
  "/:id",
  zValidator("json", z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(["draft", "active", "paused", "archived"]).optional(),
    triggerConfig: z.record(z.unknown()).optional(),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const db = getDb();
    const [campaign] = await db
      .update(campaigns)
      .set({ ...c.req.valid("json"), updatedAt: new Date() })
      .where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId)))
      .returning();
    if (!campaign) return c.json({ error: "Not found" }, 404);
    return c.json(campaign);
  }
);

app.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  await db.delete(campaigns).where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId)));
  return c.json({ success: true });
});

app.post("/:id/steps", zValidator("json", z.object({
  stepType: z.enum(["email", "wait"]),
  config: z.record(z.unknown()).default({}),
  position: z.number().int().min(0).optional(),
})), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [campaign] = await db.select().from(campaigns).where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId))).limit(1);
  if (!campaign) return c.json({ error: "Not found" }, 404);
  const body = c.req.valid("json");
  let position = body.position;
  if (position === undefined) {
    const existing = await db.select().from(campaignSteps).where(eq(campaignSteps.campaignId, campaign.id));
    position = existing.length;
  }
  const [step] = await db.insert(campaignSteps).values({ id: generateId("stp"), campaignId: campaign.id, workspaceId, stepType: body.stepType, config: body.config, position }).returning();
  return c.json(step, 201);
});

app.patch("/:id/steps/:stepId", zValidator("json", z.object({
  config: z.record(z.unknown()).optional(),
  position: z.number().int().min(0).optional(),
})), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const body = c.req.valid("json");
  const [step] = await db.update(campaignSteps).set({ ...body }).where(and(eq(campaignSteps.id, c.req.param("stepId")), eq(campaignSteps.workspaceId, workspaceId))).returning();
  if (!step) return c.json({ error: "Not found" }, 404);
  return c.json(step);
});

app.delete("/:id/steps/:stepId", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [deleted] = await db.delete(campaignSteps).where(and(eq(campaignSteps.id, c.req.param("stepId")), eq(campaignSteps.workspaceId, workspaceId))).returning({ id: campaignSteps.id });
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export default app;
