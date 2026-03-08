import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import * as schema from "@openmail/shared/schema";
import { sendPasswordResetEmail } from "./mailer.js";
import { generateId } from "@openmail/shared/ids";
import { workspaces, workspaceMembers } from "@openmail/shared/schema";

// BetterAuth infers a specific generic type from the options object, which is incompatible
// with the base ReturnType<typeof betterAuth>. `any` is required here for lazy singleton init.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _auth: any = null;

export function getAuth() {
  if (!_auth) {
    _auth = betterAuth({
      database: drizzleAdapter(getDb(), {
        provider: "pg",
        schema: {
          user: schema.user,
          session: schema.session,
          account: schema.account,
          verification: schema.verification,
        },
      }),

      emailAndPassword: {
        enabled: true,
        // Never block sign-in waiting for email verification — avoids triggering
        // email sends (and DNS lookups) on the sign-in path.
        requireEmailVerification: false,
        sendResetPassword: async ({ user, url }) => {
          await sendPasswordResetEmail({ to: user.email, resetUrl: url });
        },
      },

      // Auto-create a personal workspace for every new user on signup
      databaseHooks: {
        user: {
          create: {
            after: async (user) => {
              const db = getDb();
              const slug = slugify(user.name || user.email.split("@")[0]);
              const wsId = generateId("ws");
              const wmId = generateId("wm");

              await db.transaction(async (tx) => {
                const uniqueSlug = await ensureUniqueSlug(tx, slug);
                await tx.insert(workspaces).values({
                  id: wsId,
                  name: `${user.name || user.email.split("@")[0]}'s Workspace`,
                  slug: uniqueSlug,
                });
                await tx.insert(workspaceMembers).values({
                  id: wmId,
                  workspaceId: wsId,
                  userId: user.id,
                  role: "owner",
                });
              });
            },
          },
        },
      },

      secret: process.env.BETTER_AUTH_SECRET!,
      baseURL: process.env.BETTER_AUTH_INTERNAL_URL ?? process.env.BETTER_AUTH_URL!,
      trustedOrigins: [
        process.env.WEB_URL ?? "[REDACTED]",
        ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
      ],

      advanced: {
        // Web and API are on different up.railway.app subdomains (public suffix list),
        // so cross-subdomain cookies don't work. SameSite=None + partitioned allows the
        // browser to send the session cookie on cross-origin credentialed fetch requests.
        // Detect production by HTTPS scheme on the API URL — works regardless of NODE_ENV.
        ...(process.env.BETTER_AUTH_URL?.startsWith("https://") && {
          defaultCookieAttributes: {
            sameSite: "none" as const,
            secure: true,
            partitioned: true,
          },
        }),
      },
    });
  }
  return _auth as ReturnType<typeof betterAuth>;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "workspace";
}

// If the generated slug is taken, append a short random suffix until unique
async function ensureUniqueSlug(
  tx: Omit<ReturnType<typeof getDb>, "$client">,
  base: string,
): Promise<string> {
  let candidate = base;
  let attempts = 0;
  while (attempts < 10) {
    const [existing] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1);
    if (!existing) return candidate;
    candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    attempts++;
  }
  return `${base}-${Date.now()}`;
}

// Email templates live in api/src/lib/mailer.ts
