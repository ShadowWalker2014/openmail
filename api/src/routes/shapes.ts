import { Hono } from "hono";
import type { ApiVariables } from "../types.js";

// Allowed tables that can be synced per workspace
const ALLOWED_TABLES = new Set([
  "broadcasts",
  "email_events",
  "email_sends",
  "contacts",
  "campaigns",
  "campaign_enrollments",
  "events",
  // Stage 6 (REQ-09 timeline UI, [CN-05] workspace-scoped sync)
  "enrollment_events",
]);

const app = new Hono<{ Variables: ApiVariables }>();

/**
 * Proxy ElectricSQL shape requests through the API.
 * - Validates session auth (handled by parent router middleware)
 * - Enforces workspace_id scoping via WHERE clause
 * - Forwards all Electric-specific query params and response headers
 * - Supports both long-polling and SSE streaming
 */
app.get("/:table", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const table = c.req.param("table");

  if (!ALLOWED_TABLES.has(table)) {
    return c.json({ error: `Table '${table}' is not available for sync` }, 403);
  }

  const electricUrl = process.env.ELECTRIC_URL;
  const electricSecret = process.env.ELECTRIC_SECRET;

  if (!electricUrl) {
    return c.json({ error: "Electric sync service not configured" }, 503);
  }

  // Build upstream URL — preserve all Electric-specific query params from client
  const upstream = new URL(`${electricUrl}/v1/shape`);
  const incoming = new URL(c.req.url);

  // Forward standard Electric params from client
  for (const key of ["offset", "handle", "live", "live_sse", "replica", "columns", "cursor"]) {
    const val = incoming.searchParams.get(key);
    if (val !== null) upstream.searchParams.set(key, val);
  }

  // Enforce table + workspace scope — clients cannot override these
  upstream.searchParams.set("table", table);
  upstream.searchParams.set("where", `workspace_id = '${workspaceId}'`);

  // Attach secret server-side
  if (electricSecret) {
    upstream.searchParams.set("secret", electricSecret);
  }

  const upstreamRes = await fetch(upstream.toString(), {
    headers: { Accept: c.req.header("Accept") ?? "application/json" },
  });

  // Forward all Electric response headers the client needs
  const responseHeaders = new Headers();
  for (const header of [
    "content-type",
    "electric-handle",
    "electric-offset",
    "electric-schema",
    "electric-cursor",
    "cache-control",
    "etag",
  ]) {
    const val = upstreamRes.headers.get(header);
    if (val) responseHeaders.set(header, val);
  }
  responseHeaders.set("access-control-expose-headers", "electric-handle, electric-offset, electric-schema, electric-cursor");

  // Explicitly set CORS headers — Hono's cors() middleware may not apply to streaming
  // responses returned via `new Response(stream)`. Adding them manually ensures the
  // browser can read the response even when Electric returns a non-2xx status.
  const origin = c.req.header("Origin") ?? "";
  const webUrl = process.env.WEB_URL ?? "https://openmail.win";
  if (origin && (origin === webUrl || origin.startsWith("http://localhost"))) {
    responseHeaders.set("access-control-allow-origin", origin);
    responseHeaders.set("access-control-allow-credentials", "true");
    responseHeaders.set("vary", "Origin");
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });
});

export default app;
