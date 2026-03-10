/**
 * Event ingestion API — compatible with PostHog and Customer.io SDKs.
 *
 * Authentication (in order of precedence):
 *   1. Authorization: Bearer om_xxx          (OpenMail / PostHog style)
 *   2. "api_key" field in JSON body           (PostHog style)
 *   3. Authorization: Basic base64(x:om_xxx)  (Customer.io Basic Auth — api_key is the password)
 *
 * Endpoints:
 *   POST /api/ingest/capture                          — PostHog single-event + $groupidentify
 *   POST /api/ingest/batch                            — PostHog batch (incl. $groupidentify events)
 *   POST /api/ingest/identify                         — Identify / upsert contact
 *   POST /api/ingest/group                            — OpenMail native group upsert
 *   POST /api/ingest/track                            — OpenMail native event track
 *   POST /api/ingest/cio/v1/customers/:id             — Customer.io identify
 *   POST|PUT /api/ingest/cio/v1/customers/:id         — Customer.io identify (SDK uses PUT)
 *   POST /api/ingest/cio/v1/customers/:id/events      — Customer.io track event
 *   PUT  /api/ingest/cio/v1/objects/:typeId/:id       — Customer.io Objects (group upsert)
 *   PUT  /api/ingest/cio/v1/objects/:typeId/:id/relationships — Customer.io link contacts to group
 */
import { Hono } from "hono";
import { z } from "zod";
import { createHash } from "crypto";
import { getDb } from "@openmail/shared/db";
import { apiKeys, events, contacts } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and } from "drizzle-orm";
import { Queue } from "bullmq";
import { getQueueRedisConnection } from "../lib/redis.js";
import type { Context } from "hono";
import type { ApiVariables } from "../types.js";
import { upsertGroup, linkContactToGroup } from "./groups.js";

const app = new Hono<{ Variables: ApiVariables }>();

// CORS for this router is configured at the app level in index.ts (before the global cors).
// No need for a duplicate cors() call here.

// ── Auth helper ───────────────────────────────────────────────────────────────

async function resolveWorkspace(c: Context): Promise<string | null> {
  let rawKey: string | null = null;

  const authHeader = c.req.header("Authorization") as string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    rawKey = authHeader.slice(7).trim();
  } else if (authHeader?.startsWith("Basic ")) {
    // Customer.io uses Basic auth where the password is the API key
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const colonIdx = decoded.indexOf(":");
    rawKey = colonIdx !== -1 ? decoded.slice(colonIdx + 1).trim() : decoded.trim();
  }

  // Fall back to api_key in body
  if (!rawKey) {
    const body = await c.req.json().catch(() => ({}));
    rawKey = (body?.api_key as string | undefined)?.trim() ?? null;
  }

  if (!rawKey) return null;

  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const db = getDb();
  const [key] = await db
    .select({ workspaceId: apiKeys.workspaceId })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  return key?.workspaceId ?? null;
}

// ── Event queue ───────────────────────────────────────────────────────────────

let _q: Queue | null = null;
function getQ() {
  if (!_q) _q = new Queue("events", { connection: getQueueRedisConnection() });
  return _q;
}

// ── Core: handle a single captured event — routes $groupidentify specially ────

async function handleCapturedEvent(
  workspaceId: string,
  email: string,
  eventName: string,
  properties: Record<string, unknown>,
  occurredAt?: string,
): Promise<string> {
  // PostHog-style group identify: event="$groupidentify" with $group_type / $group_key / $group_set
  if (eventName === "$groupidentify") {
    const groupType = (properties.$group_type as string | undefined) ?? "company";
    const groupKey  = (properties.$group_key  as string | undefined);
    const groupSet  = (properties.$group_set  as Record<string, unknown> | undefined) ?? {};

    if (groupKey) {
      const group = await upsertGroup(workspaceId, groupType, groupKey, groupSet);
      // Link the identifying user to the group (if they're a known contact)
      if (email && email.includes("@")) {
        await linkContactToGroup(workspaceId, email, group.id);
      }
      // Return a synthetic ID — $groupidentify doesn't create an event record
      return `grp_${Date.now()}`;
    }
  }
  return storeEvent(workspaceId, email, eventName, properties, occurredAt);
}

// ── Core: store one event ─────────────────────────────────────────────────────

async function storeEvent(
  workspaceId: string,
  email: string,
  name: string,
  properties: Record<string, unknown>,
  occurredAt?: string,
): Promise<string> {
  const db = getDb();
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, email)))
    .limit(1);

  const id = generateId("evt");
  await db.insert(events).values({
    id,
    workspaceId,
    contactId: contact?.id ?? null,
    contactEmail: email,
    name,
    properties: properties ?? {},
    occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
  });

  await getQ().add("process-event", { eventId: id, workspaceId }, { removeOnComplete: 100 });
  return id;
}

// ── Core: upsert contact ──────────────────────────────────────────────────────

async function upsertContact(
  workspaceId: string,
  email: string,
  firstName?: string,
  lastName?: string,
  attributes?: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db
    .insert(contacts)
    .values({
      id: generateId("con"),
      workspaceId,
      email,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      attributes: attributes ?? {},
    })
    .onConflictDoUpdate({
      target: [contacts.workspaceId, contacts.email],
      set: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(attributes !== undefined && { attributes }),
        updatedAt: new Date(),
      },
    });
}

// ── POST /capture — PostHog single-event format ───────────────────────────────
// Body: { api_key, event, distinct_id, properties?, timestamp? }

app.post("/capture", async (c) => {
  const workspaceId = await resolveWorkspace(c);
  if (!workspaceId) return c.json({ error: "Invalid API key" }, 401);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const schema = z.object({
    event: z.string().min(1),
    distinct_id: z.string().min(1).describe("User email or unique ID"),
    properties: z.record(z.unknown()).optional().default({}),
    timestamp: z.string().datetime().optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation error", details: parsed.error.flatten() }, 400);
  }

  const { event, distinct_id, properties, timestamp } = parsed.data;

  // distinct_id should be an email; if not, check $email in properties
  const email =
    typeof distinct_id === "string" && distinct_id.includes("@")
      ? distinct_id
      : (properties?.$email as string | undefined) ?? distinct_id;

  const id = await handleCapturedEvent(workspaceId, email, event, properties ?? {}, timestamp);
  return c.json({ status: 1 }, 200); // PostHog returns 1 on success
});

// ── POST /batch — PostHog batch format ───────────────────────────────────────
// Body: { api_key, batch: [{ event, distinct_id, properties?, timestamp? }] }

app.post("/batch", async (c) => {
  const workspaceId = await resolveWorkspace(c);
  if (!workspaceId) return c.json({ error: "Invalid API key" }, 401);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const schema = z.object({
    batch: z.array(z.object({
      event: z.string().min(1),
      distinct_id: z.string().min(1),
      properties: z.record(z.unknown()).optional().default({}),
      timestamp: z.string().datetime().optional(),
    })).min(1).max(100),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation error", details: parsed.error.flatten() }, 400);
  }

  const results = await Promise.allSettled(
    parsed.data.batch.map((item) => {
      const email =
        typeof item.distinct_id === "string" && item.distinct_id.includes("@")
          ? item.distinct_id
          : (item.properties?.$email as string | undefined) ?? item.distinct_id;
      return handleCapturedEvent(workspaceId, email, item.event, item.properties ?? {}, item.timestamp);
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  return c.json({ status: 1, ingested: succeeded, total: parsed.data.batch.length }, 200);
});

// ── POST /identify — Identify / upsert contact ────────────────────────────────
// Body: { api_key?, distinct_id, properties?: { $email?, $name?, ... } }
// or Segment style: { api_key?, userId, traits }

app.post("/identify", async (c) => {
  const workspaceId = await resolveWorkspace(c);
  if (!workspaceId) return c.json({ error: "Invalid API key" }, 401);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  // Support PostHog, Segment, and simplified formats
  const distinctId: string = body.distinct_id ?? body.userId ?? body.user_id ?? "";
  const traits: Record<string, unknown> = body.properties ?? body.traits ?? {};

  if (!distinctId) return c.json({ error: "distinct_id or userId is required" }, 400);

  const email =
    (traits.$email as string | undefined) ??
    (traits.email as string | undefined) ??
    (distinctId.includes("@") ? distinctId : undefined);

  if (!email) return c.json({ error: "Email is required (pass as distinct_id or traits.$email)" }, 400);

  // Extract standard contact fields from traits
  const firstName =
    (traits.$name as string | undefined)?.split(" ")[0] ??
    (traits.firstName as string | undefined) ??
    (traits.first_name as string | undefined);

  const lastName =
    (traits.$name as string | undefined)?.split(" ").slice(1).join(" ") ||
    ((traits.lastName as string | undefined) ?? (traits.last_name as string | undefined));

  // Everything else goes to attributes
  const skip = new Set(["$email", "email", "$name", "firstName", "first_name", "lastName", "last_name"]);
  const attributes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(traits)) {
    if (!skip.has(k)) attributes[k] = v;
  }

  await upsertContact(workspaceId, email, firstName, lastName, attributes);
  return c.json({ status: 1 }, 200);
});

// ── POST /track — OpenMail native + generic track ─────────────────────────────
// Body: { api_key?, email, name, properties?, occurredAt? }

app.post("/track", async (c) => {
  const workspaceId = await resolveWorkspace(c);
  if (!workspaceId) return c.json({ error: "Invalid API key" }, 401);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const schema = z.object({
    email: z.string().email(),
    name: z.string().min(1),
    properties: z.record(z.unknown()).optional().default({}),
    occurredAt: z.string().datetime().optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation error", details: parsed.error.flatten() }, 400);
  }

  const id = await storeEvent(
    workspaceId,
    parsed.data.email,
    parsed.data.name,
    parsed.data.properties,
    parsed.data.occurredAt,
  );
  return c.json({ id }, 201);
});

// ── Customer.io Compatible Routes ─────────────────────────────────────────────
// Customer.io SDK sends to: https://track.customer.io/api/v1/...
// Replace host with: https://your-api/api/ingest/cio/v1/...

// POST and PUT /cio/v1/customers/:id — identify / upsert contact
// Customer.io SDK uses PUT; REST clients may use POST — both are supported.
// Basic auth: workspace_id:api_key   Body: { email?, name?, ...attributes }
async function handleCioIdentify(c: Context): Promise<Response> {
  const workspaceId = await resolveWorkspace(c);
  if (!workspaceId) return c.json({ error: "Invalid API key" }, 401);

  const customerId = c.req.param("id") ?? "";
  const body = await c.req.json().catch(() => null);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const email = (body.email as string | undefined) ??
    (customerId.includes("@") ? customerId : undefined);

  if (!email) return c.json({ error: "email is required in body or use email as customer id" }, 400);

  const { email: _e, name, first_name, last_name, ...rest } = body as Record<string, unknown>;

  const firstName =
    (first_name as string | undefined) ??
    (typeof name === "string" ? name.split(" ")[0] : undefined);

  const lastName =
    (last_name as string | undefined) ??
    (typeof name === "string" ? (name.split(" ").slice(1).join(" ") || undefined) : undefined);

  await upsertContact(workspaceId, email, firstName, lastName,
    Object.keys(rest).length > 0 ? rest : undefined);

  return new Response(null, { status: 200 });
}

// Customer.io SDK uses PUT; raw REST clients often use POST — support both
app.post("/cio/v1/customers/:id", handleCioIdentify);
app.put("/cio/v1/customers/:id", handleCioIdentify);

// DELETE /cio/v1/customers/:id — delete contact (no-op or actual delete)
app.delete("/cio/v1/customers/:id", async (c) => {
  const workspaceId = await resolveWorkspace(c);
  if (!workspaceId) return c.json({ error: "Invalid API key" }, 401);
  // Accept but don't require deletion — return 200 for compatibility
  return new Response(null, { status: 200 });
});

// POST /cio/v1/customers/:id/events — Customer.io track event
// Body: { name, data?: { ... } }
app.post("/cio/v1/customers/:id/events", async (c) => {
  const workspaceId = await resolveWorkspace(c);
  if (!workspaceId) return c.json({ error: "Invalid API key" }, 401);

  const customerId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body?.name) return c.json({ error: "name is required" }, 400);

  const email = customerId.includes("@") ? customerId : body.data?.email ?? customerId;

  await storeEvent(workspaceId, email, body.name as string, body.data ?? {});
  return new Response(null, { status: 200 });
});

// POST /cio/v1/metrics — Customer.io metrics endpoint (no-op for compat)
app.post("/cio/v1/metrics", async (c) => {
  const workspaceId = await resolveWorkspace(c);
  if (!workspaceId) return c.json({ error: "Invalid API key" }, 401);
  return new Response(null, { status: 200 });
});

// ── POST /group — OpenMail native group upsert ────────────────────────────────
// Body: { api_key?, groupType, groupKey, attributes?, contactEmail? }
app.post("/group", async (c) => {
  const workspaceId = await resolveWorkspace(c);
  if (!workspaceId) return c.json({ error: "Invalid API key" }, 401);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const groupType  = (body.groupType  as string | undefined) ?? "company";
  const groupKey   = (body.groupKey   as string | undefined);
  const attributes = (body.attributes as Record<string, unknown> | undefined) ?? {};

  if (!groupKey) return c.json({ error: "groupKey is required" }, 400);

  const group = await upsertGroup(workspaceId, groupType, groupKey, attributes);

  // Optionally link a contact to the group
  if (body.contactEmail && typeof body.contactEmail === "string") {
    await linkContactToGroup(workspaceId, body.contactEmail, group.id);
  }

  return c.json({ id: group.id, groupType: group.groupType, groupKey: group.groupKey }, 200);
});

// ── Customer.io Objects API (group management) ────────────────────────────────
// Customer.io's SDK sends:
//   PUT /objects/:objectTypeId/:objectId              — create/update a group
//   PUT /objects/:objectTypeId/:objectId/relationships— link contacts to group
//
// objectTypeId "1" = company (the default Customer.io convention)

const CIO_OBJECT_TYPE_MAP: Record<string, string> = {
  "1": "company",
  "2": "account",
  "3": "team",
  "4": "project",
};

function cioObjectTypeToGroupType(objectTypeId: string): string {
  return CIO_OBJECT_TYPE_MAP[objectTypeId] ?? `object_type_${objectTypeId}`;
}

// PUT /cio/v1/objects/:objectTypeId/:objectId — upsert a group
app.put("/cio/v1/objects/:objectTypeId/:objectId", async (c) => {
  const workspaceId = await resolveWorkspace(c);
  if (!workspaceId) return c.json({ error: "Invalid API key" }, 401);

  const objectTypeId = c.req.param("objectTypeId") ?? "";
  const objectId     = c.req.param("objectId") ?? "";
  const body         = await c.req.json().catch(() => ({})) as Record<string, unknown>;

  const groupType = cioObjectTypeToGroupType(objectTypeId);
  await upsertGroup(workspaceId, groupType, objectId, body);

  return new Response(null, { status: 200 });
});

// POST version for REST clients (same semantics as PUT)
app.post("/cio/v1/objects/:objectTypeId/:objectId", async (c) => {
  const workspaceId = await resolveWorkspace(c);
  if (!workspaceId) return c.json({ error: "Invalid API key" }, 401);

  const objectTypeId = c.req.param("objectTypeId") ?? "";
  const objectId     = c.req.param("objectId") ?? "";
  const body         = await c.req.json().catch(() => ({})) as Record<string, unknown>;

  const groupType = cioObjectTypeToGroupType(objectTypeId);
  await upsertGroup(workspaceId, groupType, objectId, body);

  return new Response(null, { status: 200 });
});

// PUT /cio/v1/objects/:objectTypeId/:objectId/relationships — link contacts to group
app.put("/cio/v1/objects/:objectTypeId/:objectId/relationships", async (c) => {
  const workspaceId = await resolveWorkspace(c);
  if (!workspaceId) return c.json({ error: "Invalid API key" }, 401);

  const objectTypeId = c.req.param("objectTypeId") ?? "";
  const objectId     = c.req.param("objectId") ?? "";
  const body         = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const groupType = cioObjectTypeToGroupType(objectTypeId);
  // First ensure the group exists
  const group = await upsertGroup(workspaceId, groupType, objectId, {});

  // Link each contact in the relationships array
  const relationships = (body.relationships as Array<{
    identifiers?: { id?: string; email?: string };
  }> | undefined) ?? [];

  await Promise.allSettled(
    relationships.map((rel) => {
      const email = rel.identifiers?.email ?? rel.identifiers?.id;
      if (email && email.includes("@")) {
        return linkContactToGroup(workspaceId, email, group.id);
      }
    })
  );

  return new Response(null, { status: 200 });
});

export default app;
