import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import * as schema from "@openmail/shared/schema";
import { getResend } from "./resend";
import { generateId } from "@openmail/shared/ids";
import { workspaces, workspaceMembers } from "@openmail/shared/schema";

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
        sendResetPassword: async ({ user, url }) => {
          const resend = getResend();
          await resend.emails.send({
            from: process.env.FROM_EMAIL ?? "OpenMail <noreply@openmail.dev>",
            to: user.email,
            subject: "Reset your OpenMail password",
            html: buildResetPasswordEmail({ url, email: user.email }),
          });
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
      baseURL: process.env.BETTER_AUTH_URL!,
      trustedOrigins: [process.env.WEB_URL ?? "http://localhost:5173"],
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
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

// ── email templates ───────────────────────────────────────────────────────────

function buildResetPasswordEmail({ url, email }: { url: string; email: string }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
  <style>
    body { margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 520px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb; }
    .header { background: #08080a; padding: 32px 40px; }
    .logo-text { color: #ffffff; font-size: 16px; font-weight: 600; letter-spacing: -0.02em; }
    .body { padding: 40px; }
    h1 { margin: 0 0 12px; font-size: 22px; font-weight: 600; color: #111827; letter-spacing: -0.02em; }
    p { margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #6b7280; }
    .email-highlight { color: #374151; font-weight: 500; }
    .button { display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; }
    .divider { border: none; border-top: 1px solid #f3f4f6; margin: 28px 0; }
    .footer { padding: 0 40px 32px; }
    .footer p { font-size: 13px; color: #9ca3af; margin: 0 0 8px; }
    .link { color: #6366f1; text-decoration: none; word-break: break-all; font-size: 13px; }
    .expiry { font-size: 13px; color: #9ca3af; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="logo-text">OpenMail</span>
    </div>
    <div class="body">
      <h1>Reset your password</h1>
      <p>We received a request to reset the password for <span class="email-highlight">${email}</span>. Click the button below to choose a new password.</p>
      <a href="${url}" class="button">Reset password</a>
      <hr class="divider" />
    </div>
    <div class="footer">
      <p>If the button doesn't work, copy and paste this link:</p>
      <a href="${url}" class="link">${url}</a>
      <p class="expiry">Link expires in 1 hour. If you didn't request this, you can safely ignore it.</p>
    </div>
  </div>
</body>
</html>`;
}
