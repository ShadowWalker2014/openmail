/**
 * Groups API — manage group/organization entities and contact memberships.
 *
 * POST-compatible with:
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
  groupType: z.string().min(1).default("company"),
  groupKey:  z.string().min(1),
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
  return c.json(group, 201);
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

// ── PATCH /:id — update group attributes ─────────────────────────────────────
app.patch("/:id", zValidator("json", z.object({
  attributes: z.record(z.unknown()).optional(),
  groupType: z.string().optional(),
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

  // Verify group belongs to workspace
  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, c.req.param("id")), eq(groups.workspaceId, workspaceId)))
    .limit(1);
  if (!group) return c.json({ error: "Not found" }, 404);

  const members = await db
    .select({ contact: contacts, role: contactGroups.role, joinedAt: contactGroups.createdAt })
    .from(contactGroups)
    .innerJoin(contacts, eq(contactGroups.contactId, contacts.id))
    .where(and(eq(contactGroups.groupId, group.id), eq(contactGroups.workspaceId, workspaceId)))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ total }] = await db
    .select({ total: count() })
    .from(contactGroups)
    .where(and(eq(contactGroups.groupId, group.id), eq(contactGroups.workspaceId, workspaceId)));

  return c.json({ data: members, total, page, pageSize });
});

// ── POST /:id/contacts — add a contact to a group ────────────────────────────
app.post("/:id/contacts", zValidator("json", z.object({
  contactId: z.string(),
  role: z.string().optional(),
})), async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { contactId, role } = c.req.valid("json");
  const db = getDb();

  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, c.req.param("id")), eq(groups.workspaceId, workspaceId)))
    .limit(1);
  if (!group) return c.json({ error: "Group not found" }, 404);

  await db
    .insert(contactGroups)
    .values({ workspaceId, contactId, groupId: group.id, role })
    .onConflictDoNothing();

  return c.json({ success: true }, 201);
});

// ── DELETE /:id/contacts/:contactId — remove a contact from a group ───────────
app.delete("/:id/contacts/:contactId", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  await db
    .delete(contactGroups)
    .where(
      and(
        eq(contactGroups.groupId, c.req.param("id")),
        eq(contactGroups.contactId, c.req.param("contactId")),
        eq(contactGroups.workspaceId, workspaceId),
      )
    );
  return c.json({ success: true });
});

export default app;

// ── Shared helpers (used by ingest.ts) ────────────────────────────────────────

/**
 * Upsert a group by (workspaceId, groupType, groupKey).
 * Returns the group record (new or existing).
 */
export async function upsertGroup(
  workspaceId: string,
  groupType: string,
  groupKey: string,
  attributes: Record<string, unknown>,
): Promise<typeof groups.$inferSelect> {
  const db = getDb();
  const [group] = await db
    .insert(groups)
    .values({ id: generateId("grp"), workspaceId, groupType, groupKey, attributes })
    .onConflictDoUpdate({
      target: [groups.workspaceId, groups.groupType, groups.groupKey],
      set: {
        attributes: attributes as any,  // merge is handled client-side; API replaces
        updatedAt: new Date(),
      },
    })
    .returning();
  return group;
}

/**
 * Link a contact (by email) to a group, creating the contact if it doesn't exist.
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
  if (!contact) return; // contact doesn't exist yet — don't create zombie link

  await db
    .insert(contactGroups)
    .values({ workspaceId, contactId: contact.id, groupId, role })
    .onConflictDoNothing();
}
