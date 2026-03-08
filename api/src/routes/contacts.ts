import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { contacts, events, emailSends } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and, ilike, count, desc } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

function parsePagination(pageStr?: string, pageSizeStr?: string) {
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(pageSizeStr ?? "50", 10) || 50));
  return { page, pageSize };
}

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { page, pageSize } = parsePagination(c.req.query("page"), c.req.query("pageSize"));
  const search = c.req.query("search");
  const db = getDb();

  const conditions = [eq(contacts.workspaceId, workspaceId)];
  if (search) conditions.push(ilike(contacts.email, `%${search}%`));

  const [{ total }] = await db.select({ total: count() }).from(contacts).where(and(...conditions));

  const data = await db
    .select()
    .from(contacts)
    .where(and(...conditions))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    // Secondary sort by id ensures stable pagination when createdAt timestamps collide.
    .orderBy(desc(contacts.createdAt), contacts.id);

  return c.json({ data, total, page, pageSize });
});

app.post(
  "/",
  zValidator("json", z.object({
    email: z.string().email(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    attributes: z.record(z.unknown()).optional(),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const body = c.req.valid("json");
    const db = getDb();
    const id = generateId("con");

    const [contact] = await db
      .insert(contacts)
      .values({ id, workspaceId, ...body })
      .onConflictDoUpdate({
        target: [contacts.workspaceId, contacts.email],
        set: { ...body, updatedAt: new Date() },
      })
      .returning();

    // Distinguish insert (new contact) from update (existing contact) by
    // checking whether the DB assigned our generated id or kept the existing one.
    const isNew = contact.id === id;
    return c.json(contact, isNew ? 201 : 200);
  }
);

app.get("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, c.req.param("id")), eq(contacts.workspaceId, workspaceId)))
    .limit(1);
  if (!contact) return c.json({ error: "Not found" }, 404);
  return c.json(contact);
});

app.patch(
  "/:id",
  zValidator("json", z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    attributes: z.record(z.unknown()).optional(),
    unsubscribed: z.boolean().optional(),
  })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const db = getDb();
    const body = c.req.valid("json");
    const [contact] = await db
      .update(contacts)
      .set({
        ...body,
        unsubscribedAt: body.unsubscribed === true ? new Date() : body.unsubscribed === false ? null : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(contacts.id, c.req.param("id")), eq(contacts.workspaceId, workspaceId)))
      .returning();
    if (!contact) return c.json({ error: "Not found" }, 404);
    return c.json(contact);
  }
);

app.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [deleted] = await db
    .delete(contacts)
    .where(and(eq(contacts.id, c.req.param("id")), eq(contacts.workspaceId, workspaceId)))
    .returning({ id: contacts.id });
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

app.get("/:id/events", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { page, pageSize } = parsePagination(c.req.query("page"), c.req.query("pageSize"));
  const db = getDb();

  // Verify the contact exists and belongs to this workspace before returning data.
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, c.req.param("id")), eq(contacts.workspaceId, workspaceId)))
    .limit(1);
  if (!contact) return c.json({ error: "Not found" }, 404);

  const data = await db.select().from(events)
    .where(and(eq(events.contactId, c.req.param("id")), eq(events.workspaceId, workspaceId)))
    .orderBy(desc(events.occurredAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return c.json(data);
});

app.get("/:id/sends", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { page, pageSize } = parsePagination(c.req.query("page"), c.req.query("pageSize"));
  const db = getDb();

  // Verify the contact exists and belongs to this workspace before returning data.
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, c.req.param("id")), eq(contacts.workspaceId, workspaceId)))
    .limit(1);
  if (!contact) return c.json({ error: "Not found" }, 404);

  const data = await db.select().from(emailSends)
    .where(and(eq(emailSends.contactId, c.req.param("id")), eq(emailSends.workspaceId, workspaceId)))
    .orderBy(desc(emailSends.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return c.json(data);
});

export default app;
