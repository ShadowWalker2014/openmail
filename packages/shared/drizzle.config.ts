import { defineConfig } from "drizzle-kit";

const isLocal = !process.env.DATABASE_URL?.includes("railway") &&
  !process.env.DATABASE_URL?.includes("neon") &&
  !process.env.DATABASE_URL?.includes("supabase");

export default defineConfig({
  schema: "./src/db/schema/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: isLocal ? false : "require",
  },
});
