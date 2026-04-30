#!/usr/bin/env bun
/**
 * Stage 6 — Replay enrollment CLI tool (REQ-13, [A6.6], CR-01, CR-17).
 *
 * Reconstructs the final state of an enrollment by sequentially applying
 * every event in `enrollment_events` (and optionally
 * `enrollment_events_archive`) ordered by `(enrollment_id, event_seq)` per
 * Stage 2 [A2.3]. Then compares to the live `campaign_enrollments` row.
 *
 *   bun run scripts/replay-enrollment.ts \
 *     --workspace-id <ws> \
 *     --enrollment-id <eev> \
 *     [--include-archive] \
 *     [--apply-fix] \
 *     [--json]
 *
 * Per CR-17: --workspace-id is REQUIRED and asserted against the row's
 * actual workspace; mismatch → exit 1 (multi-tenant isolation at CLI level).
 *
 * Per CR-01: drift detection is read-only by default. `--apply-fix` requires
 * confirmation prompt and writes corrections via `commitLifecycleStatus()`.
 * Off in this iteration — see Out of Scope.
 *
 * Exit codes:
 *   0   replayed state == current state (and warnings, if any, non-fatal)
 *   1   error (DB unreachable, invalid args, workspace mismatch)
 *   2   drift detected (state mismatch)
 */
import { sql } from "drizzle-orm";
import { getDb } from "@openmail/shared/db";
import {
  applyEvent,
} from "./lib/replay-event-dispatch.js";
import {
  emptyState,
  diffState,
  type EventRow,
  type ReplayState,
} from "../worker/src/lib/replay-state-model.js";
import type { EnrollmentEventType } from "@openmail/shared";

interface CliArgs {
  workspaceId: string;
  enrollmentId: string;
  includeArchive: boolean;
  applyFix: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = {
    includeArchive: false,
    applyFix: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace-id") out.workspaceId = argv[++i];
    else if (a === "--enrollment-id") out.enrollmentId = argv[++i];
    else if (a === "--include-archive") out.includeArchive = true;
    else if (a === "--apply-fix") out.applyFix = true;
    else if (a === "--json") out.json = true;
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  if (!out.workspaceId || !out.enrollmentId) {
    console.error("Missing required --workspace-id and --enrollment-id");
    printHelp();
    process.exit(1);
  }
  return out as CliArgs;
}

function printHelp(): void {
  console.error(
    `Usage: bun run scripts/replay-enrollment.ts \\
  --workspace-id <ws_xxx> --enrollment-id <eev_xxx> \\
  [--include-archive] [--apply-fix] [--json]

Exit codes:
  0  state matches
  1  error / invalid args / workspace mismatch
  2  drift detected
`,
  );
}

interface RawRow {
  id: string;
  enrollment_id: string | null;
  campaign_id: string;
  contact_id: string | null;
  workspace_id: string;
  event_type: string;
  payload_version: number;
  payload: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  event_seq: string | number | bigint | null;
  emitted_at: Date | string;
  from_archive?: boolean;
}

function rowToEvent(r: RawRow, fromArchive = false): EventRow {
  return {
    id: r.id,
    enrollmentId: r.enrollment_id,
    campaignId: r.campaign_id,
    contactId: r.contact_id,
    workspaceId: r.workspace_id,
    eventType: r.event_type as EnrollmentEventType,
    payloadVersion: r.payload_version ?? 1,
    payload: r.payload ?? {},
    before: r.before,
    after: r.after,
    eventSeq:
      r.event_seq == null
        ? null
        : typeof r.event_seq === "bigint"
          ? r.event_seq
          : BigInt(r.event_seq as number | string),
    emittedAt:
      r.emitted_at instanceof Date ? r.emitted_at : new Date(r.emitted_at),
    fromArchive,
  };
}

async function loadEvents(
  enrollmentId: string,
  includeArchive: boolean,
): Promise<EventRow[]> {
  const db = getDb();
  const primary = (await db.execute(sql`
    SELECT id, enrollment_id, campaign_id, contact_id, workspace_id,
           event_type, payload_version, payload, "before", "after",
           event_seq, emitted_at
      FROM enrollment_events
     WHERE enrollment_id = ${enrollmentId}
     ORDER BY event_seq ASC NULLS LAST, emitted_at ASC
  `)) as unknown as RawRow[];
  let events = primary.map((r) => rowToEvent(r, false));

  if (includeArchive) {
    const archive = (await db.execute(sql`
      SELECT id, enrollment_id, campaign_id, contact_id, workspace_id,
             event_type, payload_version, payload, "before", "after",
             event_seq, emitted_at
        FROM enrollment_events_archive
       WHERE enrollment_id = ${enrollmentId}
       ORDER BY event_seq ASC NULLS LAST, emitted_at ASC
    `)) as unknown as RawRow[];
    events = [...archive.map((r) => rowToEvent(r, true)), ...events];
    // Re-sort merged set by event_seq with emitted_at fallback.
    events.sort((a, b) => {
      if (a.eventSeq != null && b.eventSeq != null) {
        if (a.eventSeq < b.eventSeq) return -1;
        if (a.eventSeq > b.eventSeq) return 1;
        return 0;
      }
      if (a.eventSeq == null && b.eventSeq == null) {
        return a.emittedAt.getTime() - b.emittedAt.getTime();
      }
      return a.eventSeq == null ? 1 : -1;
    });
  }
  return events;
}

interface CurrentRow {
  id: string;
  campaign_id: string;
  workspace_id: string;
  contact_id: string;
  status: string;
  current_step_id: string | null;
  step_entered_at: Date | string | null;
  next_run_at: Date | string | null;
  paused_at: Date | string | null;
  force_exited_at: Date | string | null;
  stale_skipped_at: Date | string | null;
  completed_at: Date | string | null;
  completed_via_goal_id: string | null;
  spread_token: string | null;
  step_held_at: Date | string | null;
}

async function loadCurrent(enrollmentId: string): Promise<CurrentRow | null> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT id, campaign_id, workspace_id, contact_id, status,
           current_step_id, step_entered_at, next_run_at, paused_at,
           force_exited_at, stale_skipped_at, completed_at,
           completed_via_goal_id, spread_token, step_held_at
      FROM campaign_enrollments
     WHERE id = ${enrollmentId}
     LIMIT 1
  `)) as unknown as CurrentRow[];
  return rows[0] ?? null;
}

function toDate(v: Date | string | null): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function currentToReplayShape(c: CurrentRow): Partial<ReplayState> {
  return {
    status: c.status as ReplayState["status"],
    currentStepId: c.current_step_id,
    stepEnteredAt: toDate(c.step_entered_at),
    nextRunAt: toDate(c.next_run_at),
    pausedAt: toDate(c.paused_at),
    forceExitedAt: toDate(c.force_exited_at),
    staleSkippedAt: toDate(c.stale_skipped_at),
    completedAt: toDate(c.completed_at),
    completedViaGoalId: c.completed_via_goal_id,
    spreadToken: c.spread_token,
    stepHeldAt: toDate(c.step_held_at),
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.applyFix) {
    console.error(
      "[replay] --apply-fix is OFF by default per CR-01; this iteration does not write corrections.",
    );
    console.error(
      "[replay] Run without --apply-fix; review diff manually; correct via supported MCP/SDK verbs.",
    );
  }

  const current = await loadCurrent(args.enrollmentId);
  if (!current) {
    console.error(`[replay] enrollment not found: ${args.enrollmentId}`);
    return 1;
  }
  if (current.workspace_id !== args.workspaceId) {
    console.error(
      `[replay] WORKSPACE MISMATCH: enrollment belongs to ${current.workspace_id}, ` +
        `but --workspace-id was ${args.workspaceId}`,
    );
    return 1;
  }

  const events = await loadEvents(args.enrollmentId, args.includeArchive);
  if (events.length === 0) {
    console.error(
      `[replay] no events found for enrollment ${args.enrollmentId} ` +
        `(include-archive=${args.includeArchive})`,
    );
    // Empty event log + existing row = drift (row was created without events).
    return 2;
  }

  let state = emptyState({
    enrollmentId: args.enrollmentId,
    campaignId: current.campaign_id,
    workspaceId: current.workspace_id,
  });
  for (const ev of events) {
    state = applyEvent(state, ev);
  }

  const diff = diffState(state, currentToReplayShape(current));

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          enrollmentId: args.enrollmentId,
          eventsRead: events.length,
          eventsApplied: state.eventsApplied,
          warnings: state.warnings,
          drift: diff,
          current,
          replayed: state,
        },
        null,
        2,
      ),
    );
  } else {
    console.error(`[replay] events read: ${events.length}, applied: ${state.eventsApplied}`);
    if (state.warnings.length > 0) {
      console.error(`[replay] warnings (${state.warnings.length}):`);
      for (const w of state.warnings) console.error(`  - ${w}`);
    }
    if (!diff) {
      console.error(`[replay] OK — replayed state matches current row`);
    } else {
      console.error(`[replay] DRIFT DETECTED:`);
      for (const [field, vals] of Object.entries(diff)) {
        console.error(
          `  - ${field}: replayed=${JSON.stringify(vals?.replayed)} current=${JSON.stringify(
            vals?.current,
          )}`,
        );
      }
    }
  }

  return diff ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[replay] fatal:`, err);
    process.exit(1);
  });
