import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { assets } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and, desc } from "drizzle-orm";
import { generateUploadUrl, getObject, deleteObject, isStorageConfigured } from "../lib/storage.js";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  "video/mp4", "video/webm",
  "application/pdf",
]);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// GET / — list workspace assets
app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const rows = await db
    .select()
    .from(assets)
    .where(eq(assets.workspaceId, workspaceId))
    .orderBy(desc(assets.createdAt));
  return c.json(rows);
});

// POST /upload-url — get a presigned PUT URL + create pending record
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
    const userId = c.get("userId") as string;
    const { fileName, mimeType, fileSize, width, height } = c.req.valid("json");

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return c.json({ error: `File type '${mimeType}' is not allowed.` }, 422);
    }

    const id = generateId("ast");
    const ext = fileName.split(".").pop() ?? "bin";
    const s3Key = `${workspaceId}/${id}.${ext}`;

    // Create the DB record first — s3 upload atomically proves the file is real
    const db = getDb();
    await db.insert(assets).values({
      id, workspaceId,
      name: fileName.replace(/\.[^.]+$/, ""),
      fileName, mimeType, fileSize,
      s3Key,
      width: width ?? null,
      height: height ?? null,
      uploadedBy: userId,
    });

    const uploadUrl = await generateUploadUrl(s3Key, mimeType);
    return c.json({ id, uploadUrl, s3Key }, 201);
  }
);

// GET /:id/url — get a fresh presigned download URL (for in-app preview)
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

  // Return the proxy URL (stable for embedding in emails) + a preview URL
  const apiUrl = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "") ?? "";
  const proxyUrl = `${apiUrl}/api/public/assets/${workspaceId}/${id}`;
  return c.json({ proxyUrl, asset });
});

// DELETE /:id — delete from S3 + DB
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
  await db.delete(assets).where(eq(assets.id, id));
  return c.json({ success: true });
});

export default app;
