import { Hono } from "hono";
import { getDb } from "@openmail/shared/db";
import { emailSends } from "@openmail/shared/schema";
import { eq, and, desc, count, gte, lte, ilike } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

// GET /sends — all email sends for workspace with pagination + filtering
app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const page = Number(c.req.query("page") ?? 1);
  const pageSize = Number(c.req.query("pageSize") ?? 50);
  const status = c.req.query("status");
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");
  const search = c.req.query("search");

  const db = getDb();

  const conditions = [eq(emailSends.workspaceId, workspaceId)];
  if (status) conditions.push(eq(emailSends.status, status));
  if (dateFrom) conditions.push(gte(emailSends.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(emailSends.createdAt, new Date(dateTo)));
  if (search) conditions.push(ilike(emailSends.contactEmail, `%${search}%`));

  const [{ total }] = await db
    .select({ total: count() })
    .from(emailSends)
    .where(and(...conditions));

  const data = await db
    .select()
    .from(emailSends)
    .where(and(...conditions))
    .orderBy(desc(emailSends.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({ data, total, page, pageSize });
});

export default app;
