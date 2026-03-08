import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    // prepare: false is required for PgBouncer transaction pooling mode.
    // max: 10 keeps the per-instance footprint small; PgBouncer multiplexes these.
    const client = postgres(process.env.DATABASE_URL!, {
      prepare: false,
      max: 10,
    });
    _db = drizzle(client, { schema });
  }
  return _db;
}
