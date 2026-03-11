import { Hono } from "hono";
import { Resend } from "resend";
import { getDb } from "@openmail/shared/db";
import { emailSends, emailEvents, workspaces, broadcasts } from "@openmail/shared/schema";
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

// GET /sends/:id — single send with email events + HTML from Resend
app.get("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const sendId = c.req.param("id");
  const db = getDb();

  const [send] = await db
    .select()
    .from(emailSends)
    .where(and(eq(emailSends.id, sendId), eq(emailSends.workspaceId, workspaceId)))
    .limit(1);

  if (!send) return c.json({ error: "Not found" }, 404);

  // Fetch all delivery events for this send (opens, clicks, bounces, complaints)
  const events = await db
    .select()
    .from(emailEvents)
    .where(eq(emailEvents.sendId, sendId))
    .orderBy(desc(emailEvents.occurredAt));

  // Try to fetch the original sent HTML from Resend's API.
  // Use workspace's own API key first, fall back to the platform key.
  let emailHtml: string | null = null;
  let lastEvent: string | null = null;

  if (send.resendMessageId) {
    const [ws] = await db
      .select({ resendApiKey: workspaces.resendApiKey })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    const apiKey = ws?.resendApiKey || process.env.RESEND_API_KEY;
    if (apiKey) {
      const resend = new Resend(apiKey);
      const { data: resendData } = await resend.emails.get(send.resendMessageId);
      if (resendData) {
        emailHtml = resendData.html ?? null;
        lastEvent = resendData.last_event ?? null;
      }
    }
  }

  // Fall back to the broadcast's stored htmlContent if Resend doesn't have it
  // (e.g. send is older than Resend's retention period, or no message ID yet)
  if (!emailHtml && send.broadcastId) {
    const [bcast] = await db
      .select({ htmlContent: broadcasts.htmlContent })
      .from(broadcasts)
      .where(eq(broadcasts.id, send.broadcastId))
      .limit(1);
    emailHtml = bcast?.htmlContent ?? null;
  }

  return c.json({ ...send, events, emailHtml, lastEvent });
});

export default app;
