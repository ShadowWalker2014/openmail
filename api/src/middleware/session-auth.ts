import { Context, Next } from "hono";
import type { ApiVariables } from "../types.js";

export async function sessionAuth(c: Context<{ Variables: ApiVariables }>, next: Next) {
  const { getAuth } = await import("../lib/auth.js");
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("userId", session.user.id);
  c.set("user", session.user as ApiVariables["user"]);
  await next();
}
