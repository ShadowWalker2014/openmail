import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@openmail/shared/db";
import { workspaces, workspaceMembers } from "@openmail/shared/schema";
import { generateId } from "@openmail/shared/ids";
import { eq, and } from "drizzle-orm";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

// Safe subset of workspace columns — never expose resendApiKey (the private key)
// Domain info (name, status, records) is safe to expose for settings display
const SAFE_WORKSPACE_COLUMNS = {
  id: workspaces.id,
  name: workspaces.name,
  slug: workspaces.slug,
  plan: workspaces.plan,
  resendFromEmail: workspaces.resendFromEmail,
  resendFromName: workspaces.resendFromName,
  resendDomainName: workspaces.resendDomainName,
  resendDomainStatus: workspaces.resendDomainStatus,
  resendDomainRecords: workspaces.resendDomainRecords,
  createdAt: workspaces.createdAt,
  updatedAt: workspaces.updatedAt,
} as const;

app.get("/", async (c) => {
  const userId = c.get("userId") as string;
  const db = getDb();
  const members = await db
    .select({ workspace: SAFE_WORKSPACE_COLUMNS })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId));
  return c.json(members.map((m) => m.workspace));
});

app.post(
  "/",
  zValidator("json", z.object({
    name: z.string().min(1),
    slug: z.string().min(2).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  })),
  async (c) => {
    const userId = c.get("userId") as string;
    const { name, slug } = c.req.valid("json");
    const db = getDb();
    const id = generateId("ws");
    const memberId = generateId("wm");

    try {
      await db.transaction(async (tx) => {
        await tx.insert(workspaces).values({ id, name, slug });
        await tx.insert(workspaceMembers).values({ id: memberId, workspaceId: id, userId, role: "owner" });
      });
    } catch (err: unknown) {
      // PostgreSQL unique_violation on the slug column
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
        return c.json({ error: "A workspace with that slug already exists. Please choose a different slug." }, 409);
      }
      throw err;
    }

    return c.json({ id, name, slug }, 201);
  }
);

app.patch(
  "/:id",
  zValidator("json", z.object({
    name: z.string().optional(),
    resendApiKey: z.string().optional(),
    resendFromEmail: z.string().email().optional().nullable(),
    resendFromName: z.string().optional().nullable(),
  })),
  async (c) => {
    const userId = c.get("userId") as string;
    const workspaceId = c.req.param("id");
    const db = getDb();

    const [member] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);

    if (!member || (member.role !== "owner" && member.role !== "admin")) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [workspace] = await db
      .update(workspaces)
      .set({ ...c.req.valid("json"), updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning(SAFE_WORKSPACE_COLUMNS);

    return c.json(workspace);
  }
);

export default app;
