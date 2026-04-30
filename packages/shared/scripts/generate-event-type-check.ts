#!/usr/bin/env bun
/**
 * generate-event-type-check.ts — V2.4 build helper
 *
 * Keeps Drizzle CHECK constraint on `enrollment_events.event_type` in sync with
 * `ENROLLMENT_EVENT_TYPES` const-tuple (the SSOT in src/lifecycle-events.ts).
 *
 * Modes:
 *   --print   Emit `CHECK (event_type IN ('...', ...))` SQL fragment to stdout.
 *             Use when authoring a migration that expands the event_type list.
 *
 *   --verify  Connect to DB via DIRECT_DATABASE_URL / DATABASE_URL, fetch the
 *             current `enrollment_events_event_type_check` constraint definition
 *             from `pg_constraint`, parse the IN-list, and deep-compare to the
 *             const-tuple. Exit 0 on match, 1 on drift, 2 on connection error.
 *             Wired into `package.json` as `bun run check:event-types` for CI.
 *
 * Lazy env-var init (per AGENTS.md): all env vars read inside main(), never at
 * module top-level.
 */
import postgres from "postgres";
import { ENROLLMENT_EVENT_TYPES } from "../src/lifecycle-events.js";

const CONSTRAINT_NAME = "enrollment_events_event_type_check";

function buildCheckFragment(): string {
  const list = ENROLLMENT_EVENT_TYPES.map((v) => `'${v}'`).join(", ");
  return `CHECK (event_type IN (${list}))`;
}

function printMode(): void {
  process.stdout.write(buildCheckFragment() + "\n");
}

/**
 * Postgres pretty-prints CHECK constraint definitions slightly differently
 * across versions (whitespace, `::text` casts on string literals). We canonicalise
 * by extracting the literal list and comparing as a sorted set — the const-tuple
 * is order-significant for migrations but the runtime CHECK is order-agnostic.
 */
function extractValuesFromPgDef(def: string): string[] {
  // Examples we may see:
  //   CHECK ((event_type = ANY (ARRAY['enrolled'::text, 'paused'::text])))
  //   CHECK (event_type IN ('enrolled', 'paused'))
  const matches = def.match(/'([^']+)'/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1));
}

async function verifyMode(): Promise<number> {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write(
      "[verify] DIRECT_DATABASE_URL or DATABASE_URL is required\n",
    );
    return 2;
  }

  const isLocal =
    !url.includes("railway") && !url.includes("neon") && !url.includes("supabase");
  const sql = postgres(url, {
    ssl: isLocal ? false : "require",
    max: 1,
    prepare: false,
  });

  try {
    const rows = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      WHERE c.conname = ${CONSTRAINT_NAME}
    `;

    if (rows.length === 0) {
      process.stderr.write(
        `[verify] FAIL: constraint ${CONSTRAINT_NAME} not found in pg_constraint. ` +
          `Has migration 0006 been applied?\n`,
      );
      return 1;
    }

    const dbValues = extractValuesFromPgDef(rows[0].def).sort();
    const expectedValues = [...ENROLLMENT_EVENT_TYPES].sort();

    const dbSet = new Set(dbValues);
    const expectedSet = new Set(expectedValues);

    const missingInDb = [...expectedSet].filter((v) => !dbSet.has(v));
    const extraInDb = [...dbSet].filter((v) => !expectedSet.has(v));

    if (missingInDb.length === 0 && extraInDb.length === 0) {
      process.stdout.write(
        `[verify] PASS: ${CONSTRAINT_NAME} matches ENROLLMENT_EVENT_TYPES (${expectedValues.length} values)\n`,
      );
      return 0;
    }

    process.stderr.write(
      `[verify] FAIL: drift detected on ${CONSTRAINT_NAME}\n`,
    );
    if (missingInDb.length > 0) {
      process.stderr.write(
        `  Missing in DB (in const-tuple but not in DB): ${missingInDb.join(", ")}\n`,
      );
    }
    if (extraInDb.length > 0) {
      process.stderr.write(
        `  Extra in DB (in DB but not in const-tuple): ${extraInDb.join(", ")}\n`,
      );
    }
    process.stderr.write(
      `\n  Generate a migration with audited-migration helper to ALTER the CHECK.\n`,
    );
    return 1;
  } catch (err) {
    process.stderr.write(`[verify] connection/query error: ${(err as Error).message}\n`);
    return 2;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];

  if (mode === "--print") {
    printMode();
    return;
  }

  if (mode === "--verify") {
    const code = await verifyMode();
    process.exit(code);
  }

  process.stderr.write(
    "Usage: bun run scripts/generate-event-type-check.ts (--print | --verify)\n",
  );
  process.exit(2);
}

main();
