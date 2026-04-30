/**
 * Campaign goals CRUD (Stage 5 — T9, REQ-04).
 *
 * Routes (mounted at the campaigns router path so workspace scoping comes
 * for free via the parent):
 *
 *   GET    /:id/goals              — list goals for a campaign
 *   POST   /:id/goals              — create a goal
 *   PATCH  /:id/goals/:goalId      — partial update
 *   DELETE /:id/goals/:goalId      — hard delete (project convention)
 *
 * Editability per [REQ-28] mirror:
 *   - draft / active / paused → mutations allowed
 *   - stopping / stopped / archived → HTTP 409
 *
 * Audit:
 *   - Every mutation emits a campaign-aggregate event (`enrollment_id=NULL`)
 *     via `audit.emit`: goal_added / goal_updated / goal_removed.
 *   - Actor is `{kind:"user"}` when session-bound; `{kind:"agent_key"}` for
 *     api-key auth (set by the auth middleware further up). For now we
 *     always use `system` since this stage doesn't yet wire the user/agent
 *     id through — Stage 6 hardens this.
 *
 * Cache invalidation:
 *   - Each successful mutation publishes the campaignId on
 *     `goal-cache:invalidate` so worker LRUs refresh. The producer's local
 *     LRU is not relevant here (api process doesn't keep a goal LRU); we
 *     publish so workers update.
 *
 * Validation:
 *   - Zod discriminated union on `condition_type`. Each variant validates
 *     its own `condition_config` shape so a malformed `attribute` config
 *     can't masquerade as an `event` config.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import Redis from "ioredis";
import { getDb } from "@openmail/shared/db";
import {
  campaigns,
  campaignGoals,
  type CampaignGoal,
} from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { audit } from "../../../worker/src/lib/lifecycle-audit.js";
import { insertEditOutbox } from "../lib/campaign-edit-outbox.js";
import { logger } from "../lib/logger.js";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

// ── Validation schemas (Zod discriminated union per condition_type) ─────────

const eventConditionSchema = z.object({
  type: z.literal("event"),
  eventName: z.string().min(1).max(200),
  propertyFilter: z.record(z.string(), z.unknown()).optional(),
  sinceEnrollment: z.boolean().optional(),
});

const attributeConditionSchema = z.object({
  type: z.literal("attribute"),
  attributeKey: z.string().min(1).max(200),
  operator: z.enum(["eq", "neq", "gt", "lt", "contains", "exists"]),
  value: z.unknown().optional(),
});

const segmentConditionSchema = z.object({
  type: z.literal("segment"),
  segmentId: z.string().min(1),
  requireMembership: z.boolean().optional(),
});

const conditionSchema = z.discriminatedUnion("type", [
  eventConditionSchema,
  attributeConditionSchema,
  segmentConditionSchema,
]);

const createGoalSchema = z.object({
  /** Discriminated union — `type` field drives which branch validates. */
  condition: conditionSchema,
  position: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

const updateGoalSchema = z.object({
  condition: conditionSchema.optional(),
  position: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const FROZEN_STATUSES: ReadonlyArray<string> = ["stopping", "stopped", "archived"];

async function loadCampaign(workspaceId: string, campaignId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(campaigns)
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Publish cache invalidation. Lazy single ioredis publisher per process —
 * cheaper than re-connecting on every CRUD call. Errors are non-fatal: the
 * mutation already committed; staleness self-corrects via TTL.
 */
let _publisher: Redis | null = null;
function getPublisher(): Redis {
  if (!_publisher) {
    _publisher = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
    });
  }
  return _publisher;
}

async function publishGoalCacheInvalidate(campaignId: string): Promise<void> {
  try {
    await getPublisher().publish("goal-cache:invalidate", campaignId);
  } catch (err) {
    logger.warn(
      { err, campaignId },
      "publishGoalCacheInvalidate: Redis publish failed (non-fatal — TTL bounds staleness)",
    );
  }
}

/** Strip the `type` field — DB stores `condition_type` separately. */
function splitCondition(condition: z.infer<typeof conditionSchema>): {
  conditionType: CampaignGoal["conditionType"];
  conditionConfig: Record<string, unknown>;
} {
  const { type, ...rest } = condition;
  return { conditionType: type, conditionConfig: rest };
}

/** Reverse of splitCondition for API responses. */
function joinCondition(goal: CampaignGoal): {
  type: string;
  [k: string]: unknown;
} {
  return {
    type: goal.conditionType,
    ...((goal.conditionConfig ?? {}) as Record<string, unknown>),
  };
}

function shapeGoalResponse(goal: CampaignGoal) {
  return {
    id: goal.id,
    campaignId: goal.campaignId,
    workspaceId: goal.workspaceId,
    condition: joinCondition(goal),
    position: goal.position,
    enabled: goal.enabled,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/:id/goals", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const campaignId = c.req.param("id");
  const campaign = await loadCampaign(workspaceId, campaignId);
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);

  const db = getDb();
  const goals = await db
    .select()
    .from(campaignGoals)
    .where(eq(campaignGoals.campaignId, campaignId))
    .orderBy(asc(campaignGoals.position));

  return c.json({ data: goals.map(shapeGoalResponse) });
});

app.post("/:id/goals", zValidator("json", createGoalSchema), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const campaignId = c.req.param("id");
  const campaign = await loadCampaign(workspaceId, campaignId);
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);

  if (FROZEN_STATUSES.includes(campaign.status)) {
    return c.json(
      {
        error: "Campaign is in a frozen status; goals cannot be modified",
        status: campaign.status,
      },
      409,
    );
  }

  const body = c.req.valid("json");
  const { conditionType, conditionConfig } = splitCondition(body.condition);
  const goalId = generateId("gol");
  const lifecycleOpId = generateId("lop_api_goal");

  const db = getDb();

  const [created] = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(campaignGoals)
      .values({
        id: goalId,
        campaignId,
        workspaceId,
        conditionType,
        conditionConfig,
        position: body.position ?? 0,
        enabled: body.enabled ?? true,
      })
      .returning();

    await audit.emit(
      null, // campaign-aggregate
      "goal_added",
      {
        campaignId,
        workspaceId,
        contactId: null,
        actor: { kind: "system" },
        payload: {
          lifecycle_op_id: lifecycleOpId,
          goal_id: goalId,
          condition_type: conditionType,
          condition_config: conditionConfig,
          enabled: inserted.enabled,
          position: inserted.position,
        },
      },
      tx,
    );

    // Stage 6 [CR-11]: outbox row for goal_added — triggers paginated reconciliation.
    await insertEditOutbox(tx, {
      workspaceId,
      campaignId,
      editType: "goal_added",
      details: {
        goalId,
        conditionType,
        conditionConfig,
      },
      lifecycleOpId,
    });

    return [inserted];
  });

  await publishGoalCacheInvalidate(campaignId);

  return c.json(shapeGoalResponse(created), 201);
});

app.patch(
  "/:id/goals/:goalId",
  zValidator("json", updateGoalSchema),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const campaignId = c.req.param("id");
    const goalId = c.req.param("goalId");
    const campaign = await loadCampaign(workspaceId, campaignId);
    if (!campaign) return c.json({ error: "Campaign not found" }, 404);

    if (FROZEN_STATUSES.includes(campaign.status)) {
      return c.json(
        {
          error: "Campaign is in a frozen status; goals cannot be modified",
          status: campaign.status,
        },
        409,
      );
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(campaignGoals)
      .where(
        and(
          eq(campaignGoals.id, goalId),
          eq(campaignGoals.campaignId, campaignId),
        ),
      )
      .limit(1);
    if (!existing) return c.json({ error: "Goal not found" }, 404);

    const body = c.req.valid("json");
    const updates: Partial<CampaignGoal> = { updatedAt: new Date() };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (body.condition) {
      const { conditionType, conditionConfig } = splitCondition(body.condition);
      updates.conditionType = conditionType;
      updates.conditionConfig = conditionConfig;
      before.condition_type = existing.conditionType;
      before.condition_config = existing.conditionConfig;
      after.condition_type = conditionType;
      after.condition_config = conditionConfig;
    }
    if (body.position !== undefined) {
      updates.position = body.position;
      before.position = existing.position;
      after.position = body.position;
    }
    if (body.enabled !== undefined) {
      updates.enabled = body.enabled;
      before.enabled = existing.enabled;
      after.enabled = body.enabled;
    }

    const lifecycleOpId = generateId("lop_api_goal");

    const [updated] = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(campaignGoals)
        .set(updates)
        .where(
          and(
            eq(campaignGoals.id, goalId),
            eq(campaignGoals.campaignId, campaignId),
          ),
        )
        .returning();

      await audit.emit(
        null,
        "goal_updated",
        {
          campaignId,
          workspaceId,
          contactId: null,
          actor: { kind: "system" },
          payload: {
            lifecycle_op_id: lifecycleOpId,
            goal_id: goalId,
          },
          before,
          after,
        },
        tx,
      );

      // Stage 6 [CR-11]: outbox row for goal_updated.
      await insertEditOutbox(tx, {
        workspaceId,
        campaignId,
        editType: "goal_updated",
        details: { goalId, before, after },
        lifecycleOpId,
      });

      return [u];
    });

    await publishGoalCacheInvalidate(campaignId);

    return c.json(shapeGoalResponse(updated));
  },
);

app.delete("/:id/goals/:goalId", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const campaignId = c.req.param("id");
  const goalId = c.req.param("goalId");
  const campaign = await loadCampaign(workspaceId, campaignId);
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);

  if (FROZEN_STATUSES.includes(campaign.status)) {
    return c.json(
      {
        error: "Campaign is in a frozen status; goals cannot be modified",
        status: campaign.status,
      },
      409,
    );
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(campaignGoals)
    .where(
      and(
        eq(campaignGoals.id, goalId),
        eq(campaignGoals.campaignId, campaignId),
      ),
    )
    .limit(1);
  if (!existing) return c.json({ error: "Goal not found" }, 404);

  const lifecycleOpId = generateId("lop_api_goal");

  await db.transaction(async (tx) => {
    await tx
      .delete(campaignGoals)
      .where(
        and(
          eq(campaignGoals.id, goalId),
          eq(campaignGoals.campaignId, campaignId),
        ),
      );

    await audit.emit(
      null,
      "goal_removed",
      {
        campaignId,
        workspaceId,
        contactId: null,
        actor: { kind: "system" },
        payload: {
          lifecycle_op_id: lifecycleOpId,
          goal_id: goalId,
          condition_type: existing.conditionType,
        },
      },
      tx,
    );

    // Stage 6 [CR-11]: outbox row for goal_removed.
    await insertEditOutbox(tx, {
      workspaceId,
      campaignId,
      editType: "goal_removed",
      details: { goalId, conditionType: existing.conditionType },
      lifecycleOpId,
    });
  });

  await publishGoalCacheInvalidate(campaignId);

  return c.json({ success: true });
});

export default app;
