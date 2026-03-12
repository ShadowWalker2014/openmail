import { defineConfig } from "drizzle-kit";

// Drizzle-kit migrations need a direct Postgres connection, NOT PgBouncer.
// PgBouncer in transaction pool mode doesn't support the session-level
// features that drizzle-kit introspection relies on.
//
// In production, set DATABASE_URL to the direct Postgres proxy URL:
//   postgres://user:pass@proxy.host:port/openmail
//
// In development (docker-compose), use:
//   DATABASE_URL=postgresql://openmail:openmail_password@localhost:5432/openmail
//   (connect directly to postgres, not through pgbouncer on port 6432)
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!;

const isLocal = !url?.includes("railway") &&
  !url?.includes("neon") &&
  !url?.includes("supabase");

export default defineConfig({
  schema: "./src/db/schema/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url,
    ssl: isLocal ? false : "require",
  },
});
