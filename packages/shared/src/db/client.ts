import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    const client = postgres(process.env.DATABASE_URL!);
    _db = drizzle(client, { schema });
  }
  return _db;
}
