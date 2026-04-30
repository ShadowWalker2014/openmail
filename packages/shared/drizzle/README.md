# Drizzle Migrations

This directory holds Drizzle-managed schema migrations for OpenMail. Numeric
prefixes are deploy order. The `meta/` subdirectory holds Drizzle's internal
journal + per-migration snapshots — **do not hand-edit** except when guided by
this README.

## Index (Stage 2)

| File | Purpose | Deploy notes |
|------|---------|--------------|
| `0005_lifecycle_engine.sql` | Additive: `re_enrollment_policy`, status CHECK extension, `campaign_enrollments` lifecycle timestamp columns | Zero downtime; idempotent guards |
| `0006_enrollment_events.sql` | New `enrollment_events` table + 4 CHECKs + UNIQUE + 6 indexes | Independent; safe to apply at any time after 0005 |
| `0007_audit_chokepoint_trigger.sql` | Postgres trigger that BLOCKS status UPDATE outside `lifecycle.audited_tx='true'` GUC | **DO NOT APPLY** until all worker code paths route through `commitLifecycleStatus()`. Round 5 of Stage 2 will gate this. |

## Audited migrations

If a future migration needs to mutate `campaigns.status` or
`campaign_enrollments.status` — for example, a one-off backfill that
reclassifies legacy rows — it MUST use the **`auditedMigration`** helper at
[`packages/shared/src/db/lib/audited-migration.ts`](../src/db/lib/audited-migration.ts).
Otherwise the audit chokepoint trigger from `0007` will reject the UPDATE.

### Why

Stage 2 enforces a single chokepoint (`commitLifecycleStatus`) for runtime
status changes. Migrations are the legitimate exception — but every legitimate
exception must:
  1. Set the GUC `lifecycle.audited_tx = 'true'` so the Postgres trigger
     permits the UPDATE.
  2. Emit a `migration_status_change` row in `enrollment_events` with
     `actor.kind = 'migration'`, `actor.name = "<run identifier>"`, and a
     `payload` containing `migrationName`, `affected_count`, `reason`.

Both steps in the same transaction. If the migration body throws, the audit
row rolls back too — never claim "X rows changed" if the change didn't commit.

### Example

```ts
// migrations/0010_normalize_legacy_paused_to_stopped.ts
import { auditedMigration } from "@openmail/shared";
import { sql } from "drizzle-orm";

await auditedMigration(
  {
    migrationName: "0010_normalize_legacy_paused_to_stopped",
    campaignId: "*",                                  // bulk migration
    workspaceId: "*",                                 // spans workspaces
    payload: {
      affected_count: 42,
      reason:
        "Pre-Stage-2 'paused' status used as terminal stop; promoting to 'stopped' for state-machine correctness",
    },
    actorName: "ops/2026-04-30/relishev",
  },
  async (tx) => {
    // GUC is set — this UPDATE passes the audit_chokepoint trigger.
    await tx.execute(sql`
      UPDATE campaigns
         SET status = 'stopped', updated_at = NOW()
       WHERE status = 'paused'
         AND created_at < '2026-04-01'
    `);
  },
);
```

### Per-campaign variant

When the migration touches a single campaign, pass its real id (and
workspace id) so forensic queries scoped to that campaign include the
migration row:

```ts
await auditedMigration(
  {
    migrationName: "0011_force_archive_test_campaign",
    campaignId: "cmp_abc123def456",
    workspaceId: "ws_xyz789",
    payload: { affected_count: 1, reason: "test campaign cleanup" },
    actorName: "ops/2026-05-01/relishev",
  },
  async (tx) => {
    await tx.execute(sql`
      UPDATE campaigns SET status = 'archived' WHERE id = 'cmp_abc123def456'
    `);
  },
);
```

## When NOT to use `auditedMigration`

- Schema-only migrations (CREATE TABLE, ADD COLUMN, ALTER CONSTRAINT) — they
  don't UPDATE status, so the trigger isn't engaged.
- Re-running an already-applied migration — Drizzle's journal tracks what's
  applied; the helper is for the body of a fresh migration.
- Backfilling non-status columns (e.g. populating a new `step_entered_at` from
  `updated_at`). The trigger fires only on status change.

## Deploy order rules

The audit chokepoint trigger (`0007`) is the **last** migration of Stage 2. It
must not run until:

1. Worker rerouting through `commitLifecycleStatus` is merged AND deployed.
2. ESLint rule `no-direct-lifecycle-mutation` is registered AND passing.
3. Stage 2 audit-completeness integration tests pass on staging.

Round 5 of the Stage 2 plan governs this gate. See
`PRPs/sota-lifecycle-engine/03-plan-stage-2.md` task T7 banner.
