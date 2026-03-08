import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { contacts } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and, ilike, count } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const page = Number(c.req.query("page") ?? 1);
  const pageSize = Number(c.req.query("pageSize") ?? 50);
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
    .orderBy(contacts.createdAt);

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

    return c.json(contact, 201);
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
  await db.delete(contacts).where(and(eq(contacts.id, c.req.param("id")), eq(contacts.workspaceId, workspaceId)));
  return c.json({ success: true });
});

export default app;
