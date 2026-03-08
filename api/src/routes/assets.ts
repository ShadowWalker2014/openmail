import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { assets } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and, desc } from "drizzle-orm";
import {
  generateUploadUrl, getObject, putObject, deleteObject, isStorageConfigured,
} from "../lib/storage.js";
import type { ApiVariables } from "../types.js";

// SSRF protection: block private/loopback/internal hostnames and IP ranges.
// This stops requests to AWS metadata, internal Railway services, etc.
const PRIVATE_IP = [
  /^127\./,                       // loopback
  /^10\./,                        // RFC-1918 class A
  /^172\.(1[6-9]|2\d|3[01])\./,  // RFC-1918 class B
  /^192\.168\./,                  // RFC-1918 class C
  /^169\.254\./,                  // link-local (AWS EC2 metadata endpoint)
  /^0\./,                         // unspecified
  /^::1$/,                        // IPv6 loopback
];

function isSsrfSafe(rawUrl: string): boolean {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost") return false;
  if (host.endsWith(".internal") || host.endsWith(".local")) return false;

  // Block bare IP addresses in private ranges
  if (PRIVATE_IP.some((re) => re.test(host))) return false;

  return true;
}

const app = new Hono<{ Variables: ApiVariables }>();

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  "video/mp4", "video/webm",
  "application/pdf",
]);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

function apiBase(): string {
  return (process.env.BETTER_AUTH_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

function proxyUrl(workspaceId: string, assetId: string): string {
  return `${apiBase()}/api/public/assets/${workspaceId}/${assetId}`;
}

// ── GET / — list workspace assets ────────────────────────────────────────────
app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const rows = await db
    .select()
    .from(assets)
    .where(eq(assets.workspaceId, workspaceId))
    .orderBy(desc(assets.createdAt));
  return c.json(rows.map((a) => ({ ...a, proxyUrl: proxyUrl(workspaceId, a.id) })));
});

// ── GET /:id — get single asset ───────────────────────────────────────────────
app.get("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { id } = c.req.param();
  const db = getDb();
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.workspaceId, workspaceId)))
    .limit(1);
  if (!asset) return c.json({ error: "Not found" }, 404);
  return c.json({ ...asset, proxyUrl: proxyUrl(workspaceId, id) });
});

// ── POST /upload-url — presigned PUT URL for browser direct-upload ─────────
app.post(
  "/upload-url",
  zValidator("json", z.object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string(),
    fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
    width:    z.number().int().optional(),
    height:   z.number().int().optional(),
  })),
  async (c) => {
    if (!isStorageConfigured()) {
      return c.json({ error: "Storage is not configured. Set AWS_* env vars." }, 503);
    }
    const workspaceId = c.get("workspaceId") as string;
    const uploadedBy = c.get("userId") ?? "api-key";
    const { fileName, mimeType, fileSize, width, height } = c.req.valid("json");

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return c.json({ error: `File type '${mimeType}' is not allowed.` }, 422);
    }

    const id = generateId("ast");
    const ext = fileName.split(".").pop() ?? "bin";
    const s3Key = `${workspaceId}/${id}.${ext}`;

    const db = getDb();
    await db.insert(assets).values({
      id, workspaceId,
      name: fileName.replace(/\.[^.]+$/, ""),
      fileName, mimeType, fileSize,
      s3Key,
      width: width ?? null,
      height: height ?? null,
      uploadedBy,
    });

    const uploadUrl = await generateUploadUrl(s3Key, mimeType);
    return c.json({ id, uploadUrl, s3Key, proxyUrl: proxyUrl(workspaceId, id) }, 201);
  }
);

// ── POST /upload-from-url — fetch a remote URL and upload to S3 ─────────────
// This is the primary path for AI agents: pass any public image URL and get
// back a stable proxyUrl ready to embed in email HTML.
app.post(
  "/upload-from-url",
  zValidator("json", z.object({
    url:  z.string().url().describe("Public URL of the image or file to upload"),
    name: z.string().max(255).optional().describe("Optional display name (defaults to filename from URL)"),
  })),
  async (c) => {
    if (!isStorageConfigured()) {
      return c.json({ error: "Storage is not configured. Set AWS_* env vars." }, 503);
    }
    const workspaceId = c.get("workspaceId") as string;
    const uploadedBy = c.get("userId") ?? "api-key";
    const { url, name } = c.req.valid("json");

    if (!isSsrfSafe(url)) {
      return c.json({ error: "URL is not allowed (private/internal addresses are blocked)" }, 422);
    }

    const fetchRes = await fetch(url, { headers: { "User-Agent": "OpenMail/1.0 asset-importer" } });
    if (!fetchRes.ok) {
      return c.json({ error: `Failed to fetch URL (HTTP ${fetchRes.status})` }, 422);
    }

    // Reject before buffering if Content-Length header indicates oversized file
    const declaredSize = Number(fetchRes.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_FILE_SIZE) {
      return c.json({ error: `File too large: ${(declaredSize / 1024 / 1024).toFixed(1)} MB (max 25 MB)` }, 413);
    }

    const rawContentType = fetchRes.headers.get("content-type") ?? "application/octet-stream";
    const mimeType = rawContentType.split(";")[0].trim();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return c.json({ error: `File type '${mimeType}' is not allowed.` }, 422);
    }

    const buffer = Buffer.from(await fetchRes.arrayBuffer());
    if (buffer.length > MAX_FILE_SIZE) {
      return c.json({ error: `File too large: ${(buffer.length / 1024 / 1024).toFixed(1)} MB (max 25 MB)` }, 413);
    }

    const extFromMime: Record<string, string> = {
      "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
      "image/webp": "webp", "image/svg+xml": "svg", "video/mp4": "mp4",
      "video/webm": "webm", "application/pdf": "pdf",
    };
    const ext = extFromMime[mimeType] ?? "bin";
    const rawFileName = url.split("/").pop()?.split("?")[0] ?? `file.${ext}`;
    const fileName = rawFileName.includes(".") ? rawFileName : `${rawFileName}.${ext}`;
    const displayName = name ?? fileName.replace(/\.[^.]+$/, "");

    const id = generateId("ast");
    const s3Key = `${workspaceId}/${id}.${ext}`;

    await putObject(s3Key, buffer, mimeType);

    const db = getDb();
    await db.insert(assets).values({
      id, workspaceId,
      name: displayName,
      fileName, mimeType,
      fileSize: buffer.length,
      s3Key,
      uploadedBy,
    });

    return c.json({
      id, name: displayName, fileName, mimeType,
      fileSize: buffer.length,
      proxyUrl: proxyUrl(workspaceId, id),
    }, 201);
  }
);

// ── POST /upload-base64 — upload base64-encoded content ──────────────────────
// For AI agents that have file content in memory (e.g. generated images).
app.post(
  "/upload-base64",
  zValidator("json", z.object({
    content:  z.string().describe("Base64-encoded file content"),
    fileName: z.string().min(1).max(255).describe("File name with extension (e.g. banner.png)"),
    mimeType: z.string().describe("MIME type (e.g. image/png)"),
    name:     z.string().max(255).optional().describe("Optional display name"),
  })),
  async (c) => {
    if (!isStorageConfigured()) {
      return c.json({ error: "Storage is not configured. Set AWS_* env vars." }, 503);
    }
    const workspaceId = c.get("workspaceId") as string;
    const uploadedBy = c.get("userId") ?? "api-key";
    const { content, fileName, mimeType, name } = c.req.valid("json");

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return c.json({ error: `File type '${mimeType}' is not allowed.` }, 422);
    }

    const buffer = Buffer.from(content, "base64");
    if (buffer.length > MAX_FILE_SIZE) {
      return c.json({ error: `File too large: ${(buffer.length / 1024 / 1024).toFixed(1)} MB (max 25 MB)` }, 413);
    }

    const ext = fileName.split(".").pop() ?? "bin";
    const displayName = name ?? fileName.replace(/\.[^.]+$/, "");
    const id = generateId("ast");
    const s3Key = `${workspaceId}/${id}.${ext}`;

    await putObject(s3Key, buffer, mimeType);

    const db = getDb();
    await db.insert(assets).values({
      id, workspaceId,
      name: displayName,
      fileName, mimeType,
      fileSize: buffer.length,
      s3Key,
      uploadedBy,
    });

    return c.json({
      id, name: displayName, fileName, mimeType,
      fileSize: buffer.length,
      proxyUrl: proxyUrl(workspaceId, id),
    }, 201);
  }
);

// ── GET /:id/url — backwards-compat alias ─────────────────────────────────────
app.get("/:id/url", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { id } = c.req.param();
  const db = getDb();
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.workspaceId, workspaceId)))
    .limit(1);
  if (!asset) return c.json({ error: "Not found" }, 404);
  return c.json({ ...asset, proxyUrl: proxyUrl(workspaceId, id) });
});

// ── DELETE /:id — delete from S3 + DB ────────────────────────────────────────
app.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const { id } = c.req.param();
  const db = getDb();
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.workspaceId, workspaceId)))
    .limit(1);
  if (!asset) return c.json({ error: "Not found" }, 404);

  await deleteObject(asset.s3Key);
  // Include workspaceId in WHERE to guarantee workspace isolation even if the
  // SELECT-then-DELETE window is somehow exploited concurrently.
  await db.delete(assets).where(and(eq(assets.id, id), eq(assets.workspaceId, workspaceId)));
  return c.json({ success: true });
});

export default app;
