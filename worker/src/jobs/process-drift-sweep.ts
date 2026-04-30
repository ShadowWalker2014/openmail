/**
 * Stage 6 — Drift sweeper (REQ-15, [A6.7], CN-06, DB-04).
 *
 * Daily cron (default 3am) that samples a small fraction of recently-mutated
 * enrollments per top-active workspace and replays each in-process to detect
 * drift between event log and `campaign_enrollments` row.
 *
 * Per CN-06: alerts only — does NOT auto-fix. Drift is signal; auto-fix at
 * scale = catastrophic on false positive.
 *
 * Sampling per [A6.7]:
 *   - Top-100 active workspaces by recent mutation volume
 *   - 0.1% of recently-mutated enrollments within each (cap: 100 per workspace)
 *   - Stratified so one giant workspace doesn't dominate the sample
 *
 * Drift → emit `audit_drift_detected` audit event (per-enrollment) + pino
 * warning. Aggregate run summary log at end.
 */
import { Queue, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { getDb } from "@openmail/shared/db";
import {
  getQueueRedisConnection,
  getWorkerRedisConnection,
} from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { audit } from "../lib/lifecycle-audit.js";
import { enqueueWebhookDeliveries } from "./process-lifecycle-webhook.js";
import { LIFECYCLE_OP_ID_LENGTH } from "@openmail/shared";
import {
  emptyState,
  diffState,
  type EventRow,
  type ReplayState,
} from "../lib/replay-state-model.js";
// The dispatcher lives under scripts/lib because the CLI tool uses it; we
// re-import for in-process use here. Both runtimes resolve the same file.
import { applyEvent } from "../../../scripts/lib/replay-event-dispatch.js";
import type { EnrollmentEventType } from "@openmail/shared";

const QUEUE_NAME = "lifecycle-drift-sweeper" as const;
const JOB_NAME = "drift-sweep" as const;

function getCronSpec(): string {
  return process.env.LIFECYCLE_DRIFT_SWEEPER_CRON ?? "0 3 * * *";
}

function getSampleFraction(): number {
  const raw = process.env.LIFECYCLE_DRIFT_SAMPLE_FRACTION;
  const n = raw ? Number.parseFloat(raw) : 0.001;
  return Number.isFinite(n) && n > 0 ? n : 0.001;
}

function getMaxPerWorkspace(): number {
  const raw = process.env.LIFECYCLE_DRIFT_MAX_PER_WORKSPACE;
  const n = raw ? Number.parseInt(raw, 10) : 100;
  return Number.isFinite(n) && n > 0 ? n : 100;
}

function getTopWorkspaceCount(): number {
  const raw = process.env.LIFECYCLE_DRIFT_TOP_WORKSPACES;
  const n = raw ? Number.parseInt(raw, 10) : 100;
  return Number.isFinite(n) && n > 0 ? n : 100;
}

const opIdAlphabet = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  LIFECYCLE_OP_ID_LENGTH,
);
function newOpId(): string {
  return `lop_drift_${opIdAlphabet()}`;
}

let _queue: Queue | null = null;
function getDriftQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: getQueueRedisConnection() });
  }
  return _queue;
}

export async function ensureDriftSweeperSchedule(): Promise<void> {
  await getDriftQueue().add(
    JOB_NAME,
    {},
    {
      repeat: { pattern: getCronSpec() },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
      jobId: `${QUEUE_NAME}:repeat`,
    },
  );
  logger.info(
    { queue: QUEUE_NAME, cron: getCronSpec() },
    "drift-sweeper schedule installed",
  );
}

interface RawEvent {
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

function rowToEvent(r: RawEvent): EventRow {
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
    emittedAt: r.emitted_at instanceof Date ? r.emitted_at : new Date(r.emitted_at),
  };
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

async function pickTopWorkspaces(): Promise<string[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT workspace_id, COUNT(*) AS c
      FROM enrollment_events
     WHERE emitted_at >= now() - interval '24 hours'
     GROUP BY workspace_id
     ORDER BY c DESC
     LIMIT ${getTopWorkspaceCount()}
  `)) as unknown as Array<{ workspace_id: string; c: number }>;
  return rows.map((r) => r.workspace_id);
}

async function sampleEnrollments(workspaceId: string): Promise<string[]> {
  const db = getDb();
  // Bernoulli sample of recently-mutated enrollments. TABLESAMPLE BERNOULLI
  // is rough; we additionally cap at MAX_PER_WORKSPACE.
  const fraction = getSampleFraction() * 100; // % for TABLESAMPLE
  const cap = getMaxPerWorkspace();
  // Avoid TABLESAMPLE BERNOULLI quirks across PG versions — use ORDER BY
  // random() with small LIMIT instead. For typical inventory of <50k
  // recently-mutated enrollments per workspace, this is a few-ms scan.
  const rows = (await db.execute(sql`
    SELECT id
      FROM campaign_enrollments
     WHERE workspace_id = ${workspaceId}
       AND updated_at >= now() - interval '24 hours'
     ORDER BY random()
     LIMIT ${cap}
  `)) as unknown as Array<{ id: string }>;
  // Apply requested fraction by trimming
  const want = Math.max(1, Math.floor(rows.length * Math.min(1, fraction / 100 || 0.001) * 1000) || rows.length);
  return rows.slice(0, want).map((r) => r.id);
}

async function checkOne(enrollmentId: string): Promise<boolean> {
  const db = getDb();
  const evRows = (await db.execute(sql`
    SELECT id, enrollment_id, campaign_id, contact_id, workspace_id,
           event_type, payload_version, payload, "before", "after",
           event_seq, emitted_at
      FROM enrollment_events
     WHERE enrollment_id = ${enrollmentId}
     ORDER BY event_seq ASC NULLS LAST, emitted_at ASC
  `)) as unknown as RawEvent[];
  if (evRows.length === 0) return false;

  const currentRows = (await db.execute(sql`
    SELECT id, campaign_id, workspace_id, contact_id, status,
           current_step_id, step_entered_at, next_run_at, paused_at,
           force_exited_at, stale_skipped_at, completed_at,
           completed_via_goal_id, spread_token, step_held_at
      FROM campaign_enrollments
     WHERE id = ${enrollmentId}
     LIMIT 1
  `)) as unknown as CurrentRow[];
  const current = currentRows[0];
  if (!current) return false;

  let state = emptyState({
    enrollmentId,
    campaignId: current.campaign_id,
    workspaceId: current.workspace_id,
  });
  for (const r of evRows) {
    state = applyEvent(state, rowToEvent(r));
  }
  const diff = diffState(state, currentToReplayShape(current));
  if (!diff) return false;

  // Drift detected → emit audit event + warn + enqueue webhook deliveries.
  logger.warn(
    {
      enrollmentId,
      workspaceId: current.workspace_id,
      campaignId: current.campaign_id,
      diff,
      eventsApplied: state.eventsApplied,
      warnings: state.warnings,
    },
    "drift-sweeper: drift detected",
  );
  // ONE op-id per detected drift — both the audit event and the webhook
  // payload share it, so an operator alerted via webhook can grep the
  // audit log by `lifecycle_op_id` to find the corresponding event row.
  const opId = newOpId();
  const emittedAt = new Date().toISOString();
  const driftPayload = {
    lifecycle_op_id: opId,
    enrollment_id: enrollmentId,
    source: "sweeper",
    diff,
  };
  try {
    await audit.emit(
      enrollmentId,
      "audit_drift_detected",
      {
        campaignId: current.campaign_id,
        workspaceId: current.workspace_id,
        contactId: current.contact_id,
        actor: { kind: "sweeper", runId: opId },
        payload: driftPayload,
      },
    );
  } catch (err) {
    logger.error(
      { err: (err as Error).message, enrollmentId },
      "drift-sweeper: failed to emit audit event",
    );
  }
  // Webhook delivery is best-effort + non-blocking. Failures don't fail
  // the drift detection itself; the worker logs internally + persists
  // telemetry on the lifecycle_webhooks row.
  try {
    await enqueueWebhookDeliveries({
      workspaceId: current.workspace_id,
      event: "audit_drift_detected",
      lifecycleOpId: opId,
      campaignId: current.campaign_id,
      enrollmentId,
      contactId: current.contact_id,
      emittedAt,
      payload: driftPayload,
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, enrollmentId },
      "drift-sweeper: failed to enqueue webhook deliveries (non-fatal)",
    );
  }
  return true;
}

async function runDriftSweep(): Promise<{
  workspacesScanned: number;
  enrollmentsChecked: number;
  drifts: number;
}> {
  const workspaces = await pickTopWorkspaces();
  let checked = 0;
  let drifts = 0;
  for (const wsId of workspaces) {
    const ids = await sampleEnrollments(wsId);
    for (const id of ids) {
      checked++;
      try {
        const drifted = await checkOne(id);
        if (drifted) drifts++;
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, enrollmentId: id },
          "drift-sweeper: check failed (continuing)",
        );
      }
    }
  }
  return {
    workspacesScanned: workspaces.length,
    enrollmentsChecked: checked,
    drifts,
  };
}

export function createDriftSweeperWorker(): Worker {
  return new Worker(
    QUEUE_NAME,
    async () => {
      const start = Date.now();
      const stats = await runDriftSweep();
      logger.info(
        { ...stats, durationMs: Date.now() - start },
        "drift-sweeper: run complete",
      );
      return stats;
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: 1,
    },
  );
}

export async function runDriftSweepOnce() {
  return runDriftSweep();
}
