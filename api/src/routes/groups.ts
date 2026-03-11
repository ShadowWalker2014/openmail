/**
 * Groups API — manage group/organization entities and contact memberships.
 *
 * Compatible with:
 *   - PostHog  : $groupidentify events
 *   - Segment  : analytics.group()
 *   - Customer.io : Objects API
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { groups, contactGroups, contacts } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and, count, desc } from "drizzle-orm";
import { enqueueSegmentCheck } from "../lib/segment-check-queue.js";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

function parsePagination(pageStr?: string, pageSizeStr?: string) {
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(pageSizeStr ?? "50", 10) || 50));
  return { page, pageSize };
}

// ── GET / — list groups ───────────────────────────────────────────────────────
app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { page, pageSize } = parsePagination(c.req.query("page"), c.req.query("pageSize"));
  const groupType = c.req.query("groupType");
  const db = getDb();

  const conditions = [eq(groups.workspaceId, workspaceId)];
  if (groupType) conditions.push(eq(groups.groupType, groupType));

  const [{ total }] = await db.select({ total: count() }).from(groups).where(and(...conditions));
  const data = await db
    .select()
    .from(groups)
    .where(and(...conditions))
    .orderBy(desc(groups.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({ data, total, page, pageSize });
});

// ── POST / — create or upsert a group ────────────────────────────────────────
const groupSchema = z.object({
  groupType:  z.string().min(1).default("company"),
  groupKey:   z.string().min(1),
  attributes: z.record(z.unknown()).optional().default({}),
});

app.post("/", zValidator("json", groupSchema), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const body = c.req.valid("json");
  const db = getDb();

  const [group] = await db
    .insert(groups)
    .values({ id: generateId("grp"), workspaceId, ...body })
    .onConflictDoUpdate({
      target: [groups.workspaceId, groups.groupType, groups.groupKey],
      set: { attributes: body.attributes, updatedAt: new Date() },
    })
    .returning();
  // Always return 200 — this is an upsert; 201 on conflict-update would be semantically wrong
  return c.json(group, 200);
});

// ── GET /:id — get a group ────────────────────────────────────────────────────
app.get("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, c.req.param("id")), eq(groups.workspaceId, workspaceId)))
    .limit(1);
  if (!group) return c.json({ error: "Not found" }, 404);
  return c.json(group);
});

// ── PATCH /:id — replace group attributes ─────────────────────────────────────
// NOTE: This performs a FULL REPLACEMENT of the attributes object, not a merge.
// Call GET first and merge manually if you need patch semantics.
app.patch("/:id", zValidator("json", z.object({
  attributes: z.record(z.unknown()).optional(),
  groupType:  z.string().min(1).optional(),
})), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const body = c.req.valid("json");
  const db = getDb();
  const [updated] = await db
    .update(groups)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(groups.id, c.req.param("id")), eq(groups.workspaceId, workspaceId)))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

// ── DELETE /:id — delete a group ──────────────────────────────────────────────
app.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [deleted] = await db
    .delete(groups)
    .where(and(eq(groups.id, c.req.param("id")), eq(groups.workspaceId, workspaceId)))
    .returning({ id: groups.id });
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

// ── GET /:id/contacts — list contacts in a group ──────────────────────────────
app.get("/:id/contacts", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { page, pageSize } = parsePagination(c.req.query("page"), c.req.query("pageSize"));
  const db = getDb();

  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, c.req.param("id")), eq(groups.workspaceId, workspaceId)))
    .limit(1);
  if (!group) return c.json({ error: "Not found" }, 404);

  const [{ total }, members] = await Promise.all([
    db.select({ total: count() })
      .from(contactGroups)
      .where(and(eq(contactGroups.groupId, group.id), eq(contactGroups.workspaceId, workspaceId)))
      .then(([r]) => r),
    db.select({ contact: contacts, role: contactGroups.role, joinedAt: contactGroups.createdAt })
      .from(contactGroups)
      .innerJoin(contacts, eq(contactGroups.contactId, contacts.id))
      .where(and(eq(contactGroups.groupId, group.id), eq(contactGroups.workspaceId, workspaceId)))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);

  return c.json({ data: members, total, page, pageSize });
});

// ── POST /:id/contacts — add a contact to a group ────────────────────────────
app.post("/:id/contacts", zValidator("json", z.object({
  contactId: z.string(),
  role:      z.string().optional(),
})), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { contactId, role } = c.req.valid("json");
  const db = getDb();

  // Verify the group belongs to this workspace
  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, c.req.param("id")), eq(groups.workspaceId, workspaceId)))
    .limit(1);
  if (!group) return c.json({ error: "Group not found" }, 404);

  // FIX (HIGH): Verify the contact ALSO belongs to this workspace.
  // Without this check, an attacker could link contacts from another workspace.
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)))
    .limit(1);
  if (!contact) return c.json({ error: "Contact not found" }, 404);

  await db
    .insert(contactGroups)
    .values({ workspaceId, contactId: contact.id, groupId: group.id, role })
    .onConflictDoNothing();

  // Group membership change may affect group.* segment conditions
  enqueueSegmentCheck(contact.id, workspaceId, "group_changed").catch(() => {});

  // Return 200 (idempotent — link may already exist; returning 201 when it was a no-op is wrong)
  return c.json({ success: true }, 200);
});

// ── DELETE /:id/contacts/:contactId — remove a contact from a group ───────────
app.delete("/:id/contacts/:contactId", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [deleted] = await db
    .delete(contactGroups)
    .where(
      and(
        eq(contactGroups.groupId, c.req.param("id")),
        eq(contactGroups.contactId, c.req.param("contactId")),
        eq(contactGroups.workspaceId, workspaceId),
      )
    )
    .returning({ contactId: contactGroups.contactId });

  if (!deleted) return c.json({ error: "Not found" }, 404);
  // Group removal may flip group.* segment conditions (segment_exit)
  enqueueSegmentCheck(deleted.contactId, workspaceId, "group_changed").catch(() => {});
  return c.json({ success: true });
});

export default app;

// ── Shared helpers (used by ingest.ts) ────────────────────────────────────────

/**
 * Upsert a group by (workspaceId, groupType, groupKey).
 * Returns the group record (new or existing).
 *
 * When `attributes` is non-empty the stored attributes are fully replaced.
 * When `attributes` is empty ({}) the existing attributes are preserved —
 * this allows callers (e.g. the relationships endpoint) to ensure the row
 * exists without accidentally wiping data.
 */
export async function upsertGroup(
  workspaceId: string,
  groupType: string,
  groupKey: string,
  attributes: Record<string, unknown>,
): Promise<typeof groups.$inferSelect> {
  const db = getDb();
  const hasAttributes = Object.keys(attributes).length > 0;

  const [group] = await db
    .insert(groups)
    .values({ id: generateId("grp"), workspaceId, groupType, groupKey, attributes })
    .onConflictDoUpdate({
      target: [groups.workspaceId, groups.groupType, groups.groupKey],
      set: {
        // FIX (CRITICAL): Only update attributes when the caller explicitly
        // provides them. Passing {} from the relationships endpoint used to
        // wipe the entire attributes column on every call.
        ...(hasAttributes ? { attributes } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  return group;
}

/**
 * Link a contact (by email) to a group.
 * If the contact does not exist in the workspace this is a no-op —
 * no zombie links are created. The caller must ensure the contact exists first.
 */
export async function linkContactToGroup(
  workspaceId: string,
  email: string,
  groupId: string,
  role?: string,
): Promise<void> {
  const db = getDb();
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, email)))
    .limit(1);
  if (!contact) return;

  await db
    .insert(contactGroups)
    .values({ workspaceId, contactId: contact.id, groupId, role })
    .onConflictDoNothing();
}
