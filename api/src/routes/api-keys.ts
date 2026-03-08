import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { apiKeys } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

app.get("/", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const keys = await db.select({
    id: apiKeys.id,
    name: apiKeys.name,
    keyPrefix: apiKeys.keyPrefix,
    lastUsedAt: apiKeys.lastUsedAt,
    createdAt: apiKeys.createdAt,
  }).from(apiKeys).where(eq(apiKeys.workspaceId, workspaceId));
  return c.json(keys);
});

app.post(
  "/",
  zValidator("json", z.object({ name: z.string().min(1) })),
  async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const { name } = c.req.valid("json");
    const db = getDb();

    const rawKey = `om_${randomBytes(24).toString("hex")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 10);

    const [key] = await db.insert(apiKeys).values({
      id: generateId("key"),
      workspaceId,
      name,
      keyHash,
      keyPrefix,
    }).returning();

    // Explicitly omit keyHash and workspaceId from the response
    const { keyHash: _kh, workspaceId: _ws, ...safeKey } = key;
    return c.json({ ...safeKey, key: rawKey }, 201);
  }
);

app.delete("/:id", async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const db = getDb();
  const [deleted] = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, c.req.param("id")), eq(apiKeys.workspaceId, workspaceId)))
    .returning({ id: apiKeys.id });
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export default app;
