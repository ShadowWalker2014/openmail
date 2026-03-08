import { Hono } from "hono";
import { getDb } from "@openmail/shared/db";
import { emailSends } from "@openmail/shared/schema";
import { eq, and, desc, count, gte, lte, ilike } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

const VALID_STATUSES = new Set(["queued", "sent", "failed", "bounced"]);

function parsePagination(pageStr?: string, pageSizeStr?: string) {
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(pageSizeStr ?? "50", 10) || 50));
  return { page, pageSize };
}

// GET /sends — all email sends for workspace with pagination + filtering
app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { page, pageSize } = parsePagination(c.req.query("page"), c.req.query("pageSize"));
  const status = c.req.query("status");
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");
  const search = c.req.query("search");

  if (status && !VALID_STATUSES.has(status)) {
    return c.json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(", ")}` }, 400);
  }

  // Validate date strings upfront — new Date("garbage") silently produces
  // Invalid Date which causes a Postgres type error at query time.
  if (dateFrom) {
    const d = new Date(dateFrom);
    if (isNaN(d.getTime())) return c.json({ error: "Invalid dateFrom. Use ISO 8601 format." }, 400);
  }
  if (dateTo) {
    const d = new Date(dateTo);
    if (isNaN(d.getTime())) return c.json({ error: "Invalid dateTo. Use ISO 8601 format." }, 400);
  }

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
