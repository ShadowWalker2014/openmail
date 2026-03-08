import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@openmail/shared/db";
import * as schema from "@openmail/shared/schema";

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
      emailAndPassword: { enabled: true },
      secret: process.env.BETTER_AUTH_SECRET!,
      baseURL: process.env.BETTER_AUTH_URL!,
      trustedOrigins: [process.env.WEB_URL ?? "http://localhost:5173"],
    });
  }
  return _auth as ReturnType<typeof betterAuth>;
}
