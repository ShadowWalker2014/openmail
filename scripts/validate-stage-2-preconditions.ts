#!/usr/bin/env bun
/**
 * Pre-deploy Stage 2 precondition validator (Stage 2 — T21).
 *
 * Verifies that the production database state is compatible with the new
 * Stage 2 default of `re_enrollment_policy = 'never'` (CR-05). Specifically,
 * it scans `campaign_enrollments` for any (contact_id, campaign_id) pair with
 * MORE THAN ONE row.
 *
 * Why: pre-Stage-2 the engine had no policy column — duplicate enrollments
 * were physically possible if a workspace's caller bypassed the engine's
 * idempotency check (custom worker, raw SQL, partial migration). Stage 2's
 * `never` policy assumes "one enrollment per (contact, campaign) lifetime".
 * If duplicates already exist, the deploy can proceed but the operator MUST
 * be aware: those duplicates remain (we do not auto-clean), and any future
 * trigger firing for those contacts will be policy-blocked.
 *
 * Run BEFORE the Stage 2 deploy (typically as part of the deploy runbook):
 *
 *     DIRECT_DATABASE_URL=postgresql://... bun run scripts/validate-stage-2-preconditions.ts
 *
 * Exit codes:
 *   0   No duplicates found — safe to deploy.
 *   2   Duplicates found — manual triage required. Diagnostic table printed
 *       to stderr (top 10 (contact_id, campaign_id) pairs with COUNT(*)).
 *   3   DB connection / query error — verify env and Postgres reachability.
 *
 * Lazy env-var init per AGENTS.md: env reads inside `main()` only.
 */
import postgres from "postgres";

interface DuplicateRow {
  contact_id: string;
  campaign_id: string;
  cnt: string;
}

async function main(): Promise<number> {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write(
      "[validate-stage-2] DIRECT_DATABASE_URL or DATABASE_URL is required.\n",
    );
    return 3;
  }

  // Match the convention from packages/shared/scripts/generate-event-type-check.ts.
  const isLocal =
    !url.includes("railway") && !url.includes("neon") && !url.includes("supabase");
  const sql = postgres(url, {
    ssl: isLocal ? false : "require",
    max: 1,
    prepare: false,
  });

  try {
    const rows = await sql<DuplicateRow[]>`
      SELECT
        contact_id,
        campaign_id,
        COUNT(*)::text AS cnt
      FROM campaign_enrollments
      GROUP BY contact_id, campaign_id
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `;

    if (rows.length === 0) {
      process.stdout.write(
        "[validate-stage-2] PASS: no duplicate (contact_id, campaign_id) pairs found.\n" +
          "  Default re_enrollment_policy='never' is consistent with current data.\n",
      );
      return 0;
    }

    process.stderr.write(
      `[validate-stage-2] FAIL: ${rows.length} duplicate (contact_id, campaign_id) pairs detected.\n` +
        "  Stage 2 default re_enrollment_policy='never' assumes ≤1 enrollment per (contact, campaign).\n" +
        "  Duplicates remain in the DB after deploy; future triggers WILL be policy-blocked for these contacts.\n\n",
    );
    process.stderr.write("  Top offenders (showing up to 10):\n");
    process.stderr.write(
      "  " +
        ["contact_id", "campaign_id", "count"].map((h) => h.padEnd(24)).join("") +
        "\n",
    );
    process.stderr.write("  " + "-".repeat(72) + "\n");
    for (const r of rows) {
      process.stderr.write(
        "  " +
          [r.contact_id, r.campaign_id, r.cnt]
            .map((v) => v.padEnd(24))
            .join("") +
          "\n",
      );
    }
    process.stderr.write(
      "\n  Triage options:\n" +
        "    a) DELETE the older duplicate rows (preserves the most recent enrollment per pair).\n" +
        "    b) Set re_enrollment_policy='always' on affected campaigns (allows future re-fire).\n" +
        "    c) Accept the gap and document the affected contacts.\n\n" +
        "  Re-run this script after triage to confirm.\n",
    );
    return 2;
  } catch (err) {
    process.stderr.write(
      `[validate-stage-2] DB error: ${(err as Error).message}\n`,
    );
    return 3;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[validate-stage-2] uncaught: ${err}\n`);
    process.exit(3);
  });
