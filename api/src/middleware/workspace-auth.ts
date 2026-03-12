import { Context, Next } from "hono";
import { getDb } from "@openmail/shared/db";
import { apiKeys } from "@openmail/shared/schema";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";
import type { ApiVariables } from "../types.js";
import { logger } from "../lib/logger.js";

export async function workspaceApiKeyAuth(c: Context<{ Variables: ApiVariables }>, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing API key" }, 401);
  }

  const key = authHeader.slice(7);
  const keyHash = createHash("sha256").update(key).digest("hex");
  const db = getDb();

  const [apiKey] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!apiKey) return c.json({ error: "Invalid API key" }, 401);

  // Fire-and-forget: don't block the request on this bookkeeping update
  db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, apiKey.id)).catch((err) => logger.warn({ err }, "Failed to update API key lastUsedAt"));

  c.set("workspaceId", apiKey.workspaceId);
  await next();
}
