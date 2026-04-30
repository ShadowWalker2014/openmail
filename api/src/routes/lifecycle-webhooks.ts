/**
 * Lifecycle webhooks API (Stage 6 follow-up).
 *
 * Operator-managed registry of HTTP endpoints that receive lifecycle audit
 * events. Today the only emitter is the drift sweeper
 * (`audit_drift_detected`); the schema is forward-compatible with any of the
 * 32 lifecycle event types.
 *
 * Routes:
 *   GET    /workspace/lifecycle-webhooks            → list all (with telemetry; secrets MASKED)
 *   POST   /workspace/lifecycle-webhooks            → create (admin/owner only)
 *   PATCH  /workspace/lifecycle-webhooks/:id        → update (admin/owner only)
 *   DELETE /workspace/lifecycle-webhooks/:id        → delete (admin/owner only)
 *   POST   /workspace/lifecycle-webhooks/:id/test   → fire a synthetic delivery (admin/owner)
 *
 * Mounted under /api/session/ws/:workspaceId so workspace-membership
 * middleware already enforces auth. Role gate (owner/admin) checked here.
 *
 * Secrets are NEVER returned in GET responses — only `secret_preview`
 * (last 4 chars) so operators can identify which secret is on record
 * without leaking it. PATCH allows resetting the secret; the new value is
 * returned ONCE in the PATCH response (similar to api_keys flow).
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { getDb } from "@openmail/shared/db";
import { lifecycleWebhooks } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { ENROLLMENT_EVENT_TYPES } from "@openmail/shared/lifecycle-events";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

function isAdminOrOwner(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

const secretAlphabet = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  32,
);
function newSecret(): string {
  // 32 chars from a 62-char alphabet ≈ 190 bits of entropy.
  return secretAlphabet();
}

function maskSecret(secret: string): string {
  if (secret.length <= 4) return "****";
  return `…${secret.slice(-4)}`;
}

const eventTypeSchema = z.enum(ENROLLMENT_EVENT_TYPES);

const createSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), {
      message: "URL must start with http:// or https://",
    }),
  // Empty array = subscribe to ALL event types.
  event_types: z.array(eventTypeSchema).default([]),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
  // Optional caller-provided secret (e.g. operator wants to reuse an
  // existing shared secret). If omitted, the server generates a 32-char
  // alphanum secret and returns it ONCE in the response.
  secret: z
    .string()
    .min(16, "secret must be at least 16 characters")
    .max(256)
    .optional(),
});

const patchSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u))
    .optional(),
  event_types: z.array(eventTypeSchema).optional(),
  description: z.string().max(500).nullish(),
  enabled: z.boolean().optional(),
  // `regenerate_secret: true` rotates the secret server-side. The new value
  // is returned ONCE; old secret immediately invalidated.
  regenerate_secret: z.literal(true).optional(),
});

// ── GET /  list ──────────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const rows = await db
    .select()
    .from(lifecycleWebhooks)
    .where(eq(lifecycleWebhooks.workspaceId, workspaceId))
    .orderBy(desc(lifecycleWebhooks.createdAt));
  return c.json({
    data: rows.map((r) => ({
      id: r.id,
      workspace_id: r.workspaceId,
      url: r.url,
      event_types: r.eventTypes,
      enabled: r.enabled,
      description: r.description,
      secret_preview: maskSecret(r.secret),
      last_delivered_at: r.lastDeliveredAt,
      last_status: r.lastStatus,
      last_error: r.lastError,
      consecutive_failures: r.consecutiveFailures,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    })),
  });
});

// ── POST /  create ───────────────────────────────────────────────────────────

app.post("/", zValidator("json", createSchema), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const member = c.get("workspaceMember") as { role?: string } | undefined;
  if (!isAdminOrOwner(member?.role)) {
    return c.json(
      { error: "Forbidden", reason: "owner or admin role required" },
      403,
    );
  }
  const body = c.req.valid("json");
  const id = generateId("lwh");
  const secret = body.secret ?? newSecret();
  const db = getDb();
  await db.insert(lifecycleWebhooks).values({
    id,
    workspaceId,
    url: body.url,
    secret,
    eventTypes: body.event_types,
    enabled: body.enabled,
    description: body.description ?? null,
  });
  // Returned ONCE: the freshly-minted secret. Subsequent GETs only show a
  // mask. Operator must persist this value in their secrets manager.
  return c.json(
    {
      id,
      workspace_id: workspaceId,
      url: body.url,
      event_types: body.event_types,
      enabled: body.enabled,
      description: body.description ?? null,
      secret,
      secret_preview: maskSecret(secret),
    },
    201,
  );
});

// ── PATCH /:id  update / regenerate secret ──────────────────────────────────

app.patch("/:id", zValidator("json", patchSchema), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const member = c.get("workspaceMember") as { role?: string } | undefined;
  if (!isAdminOrOwner(member?.role)) {
    return c.json(
      { error: "Forbidden", reason: "owner or admin role required" },
      403,
    );
  }
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const db = getDb();

  // Confirm ownership first.
  const [existing] = await db
    .select()
    .from(lifecycleWebhooks)
    .where(
      and(
        eq(lifecycleWebhooks.id, id),
        eq(lifecycleWebhooks.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const newSecretValue = body.regenerate_secret ? newSecret() : null;
  const updateValues: Record<string, unknown> = { updatedAt: new Date() };
  if (body.url !== undefined) updateValues.url = body.url;
  if (body.event_types !== undefined) updateValues.eventTypes = body.event_types;
  if (body.description !== undefined)
    updateValues.description = body.description;
  if (body.enabled !== undefined) updateValues.enabled = body.enabled;
  if (newSecretValue) {
    updateValues.secret = newSecretValue;
    // Reset failure counter on rotation — operator fixed something.
    updateValues.consecutiveFailures = 0;
    updateValues.lastError = null;
  }

  await db
    .update(lifecycleWebhooks)
    .set(updateValues)
    .where(eq(lifecycleWebhooks.id, id));

  // If secret was rotated, return new value ONCE.
  return c.json({
    id,
    workspace_id: workspaceId,
    ...(newSecretValue ? { secret: newSecretValue } : {}),
    secret_preview: maskSecret(newSecretValue ?? existing.secret),
    updated: Object.keys(updateValues).filter((k) => k !== "updatedAt"),
  });
});

// ── DELETE /:id ──────────────────────────────────────────────────────────────

app.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const member = c.get("workspaceMember") as { role?: string } | undefined;
  if (!isAdminOrOwner(member?.role)) {
    return c.json(
      { error: "Forbidden", reason: "owner or admin role required" },
      403,
    );
  }
  const id = c.req.param("id");
  const db = getDb();
  const result = (await db.execute(sql`
    DELETE FROM lifecycle_webhooks
     WHERE id = ${id}::text
       AND workspace_id = ${workspaceId}::text
     RETURNING id
  `)) as unknown as Array<{ id: string }>;
  if (result.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ id, deleted: true });
});

// ── POST /:id/test  fire synthetic delivery ─────────────────────────────────

app.post("/:id/test", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const member = c.get("workspaceMember") as { role?: string } | undefined;
  if (!isAdminOrOwner(member?.role)) {
    return c.json(
      { error: "Forbidden", reason: "owner or admin role required" },
      403,
    );
  }
  const id = c.req.param("id");
  const db = getDb();
  const [wh] = await db
    .select()
    .from(lifecycleWebhooks)
    .where(
      and(
        eq(lifecycleWebhooks.id, id),
        eq(lifecycleWebhooks.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!wh) return c.json({ error: "Not found" }, 404);

  // Synthesize a test event payload — clearly marked as a test in payload.
  // Avoids accidentally polluting the real event log; we DON'T emit a
  // real `audit_drift_detected` row, just exercise the HTTP delivery
  // pathway (HMAC, headers, network, operator endpoint).
  const { deliverWebhookOnce } = await import(
    "../../../worker/src/jobs/process-lifecycle-webhook.js"
  );
  const opId = `lop_test_${Date.now().toString(36)}`;
  const result = await deliverWebhookOnce(
    {
      webhookId: wh.id,
      workspaceId,
      event: "audit_drift_detected",
      lifecycleOpId: opId,
      campaignId: "__test__",
      enrollmentId: null,
      contactId: null,
      emittedAt: new Date().toISOString(),
      payload: {
        lifecycle_op_id: opId,
        source: "manual_test",
        diff: {
          status: { replayed: "active", current: "completed" },
        },
        note: "This is a synthetic test delivery from the OpenMail dashboard. No actual drift was detected.",
      },
    },
    wh.url,
    wh.secret,
  );

  return c.json({
    delivered: result.ok,
    status: result.status,
    error: result.errorMessage ?? null,
  });
});

export default app;
