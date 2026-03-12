import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { campaigns, campaignSteps } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and, max, count, desc } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

// Valid status machine transitions — archived is a terminal state.
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["active", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
};

function parsePagination(pageStr?: string, pageSizeStr?: string) {
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr ?? "50", 10) || 50));
  return { page, pageSize };
}

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { page, pageSize } = parsePagination(c.req.query("page"), c.req.query("pageSize"));
  const db = getDb();
  const [{ total }] = await db.select({ total: count() }).from(campaigns).where(eq(campaigns.workspaceId, workspaceId));
  const data = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.workspaceId, workspaceId))
    .orderBy(desc(campaigns.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return c.json({ data, total, page, pageSize });
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

    // Validate that required triggerConfig keys are present for each trigger type.
    if ((body.triggerType === "segment_enter" || body.triggerType === "segment_exit") && !body.triggerConfig?.segmentId) {
      return c.json({ error: `triggerConfig.segmentId is required for triggerType "${body.triggerType}"` }, 400);
    }
    if (body.triggerType === "event" && !body.triggerConfig?.eventName) {
      return c.json({ error: 'triggerConfig.eventName is required for triggerType "event"' }, 400);
    }

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
    const body = c.req.valid("json");

    // Pre-fetch so we can validate the status transition before mutating.
    const [existing] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId)))
      .limit(1);
    if (!existing) return c.json({ error: "Not found" }, 404);

    if (body.status && body.status !== existing.status) {
      const allowed = VALID_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(body.status)) {
        return c.json(
          { error: `Invalid status transition from "${existing.status}" to "${body.status}"` },
          400
        );
      }
      if (body.status === "active") {
        const [firstStep] = await db
          .select({ id: campaignSteps.id })
          .from(campaignSteps)
          .where(eq(campaignSteps.campaignId, c.req.param("id")))
          .limit(1);
        if (!firstStep) return c.json({ error: "Cannot activate a campaign with no steps" }, 400);
      }
    }

    const [updated] = await db
      .update(campaigns)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId)))
      .returning();
    return c.json(updated);
  }
);

app.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();

  const [existing] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) return c.json({ error: "Not found" }, 404);
  if (existing.status === "active") {
    return c.json({ error: "Cannot delete an active campaign. Pause or archive it first." }, 400);
  }

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
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, c.req.param("id")), eq(campaigns.workspaceId, workspaceId)))
    .limit(1);
  if (!campaign) return c.json({ error: "Not found" }, 404);
  if (campaign.status !== "draft") {
    return c.json({ error: "Can only add steps to draft campaigns" }, 400);
  }

  const body = c.req.valid("json");
  let position = body.position;
  if (position === undefined) {
    // Use MAX(position) + 1 to avoid gaps left by deletions and to be
    // more robust than counting rows (though still not perfectly atomic).
    const [{ maxPos }] = await db
      .select({ maxPos: max(campaignSteps.position) })
      .from(campaignSteps)
      .where(eq(campaignSteps.campaignId, campaign.id));
    position = (maxPos ?? -1) + 1;
  }

  const [step] = await db
    .insert(campaignSteps)
    .values({ id: generateId("stp"), campaignId: campaign.id, workspaceId, stepType: body.stepType, config: body.config, position })
    .returning();
  return c.json(step, 201);
});

app.patch("/:id/steps/:stepId", zValidator("json", z.object({
  config: z.record(z.unknown()).optional(),
  position: z.number().int().min(0).optional(),
})), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const body = c.req.valid("json");
  // Include eq(campaignSteps.campaignId, ...) so the /:id URL param is actually
  // enforced — prevents modifying a step that belongs to a different campaign.
  const [step] = await db
    .update(campaignSteps)
    .set({ ...body })
    .where(and(
      eq(campaignSteps.id, c.req.param("stepId")),
      eq(campaignSteps.campaignId, c.req.param("id")),
      eq(campaignSteps.workspaceId, workspaceId),
    ))
    .returning();
  if (!step) return c.json({ error: "Not found" }, 404);
  return c.json(step);
});

app.delete("/:id/steps/:stepId", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  // Include eq(campaignSteps.campaignId, ...) so the /:id URL param is enforced.
  const [deleted] = await db
    .delete(campaignSteps)
    .where(and(
      eq(campaignSteps.id, c.req.param("stepId")),
      eq(campaignSteps.campaignId, c.req.param("id")),
      eq(campaignSteps.workspaceId, workspaceId),
    ))
    .returning({ id: campaignSteps.id });
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export default app;
