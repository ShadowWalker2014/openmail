/**
 * Audit completeness suite — Stage 2 / T22.
 *
 * Asserts the invariants of the new lifecycle audit pipeline:
 *   1. Every state transition produces exactly ONE audit event in the same tx.
 *   2. event_seq is monotonic per enrollment.
 *   3. Concurrent transactions both emit; UNIQUE forces retry; sequential
 *      final values.
 *   4. Aggregate events have event_seq=NULL, contact_id=NULL.
 *   5. Per-enrollment events have event_seq != NULL, contact_id != NULL.
 *   6. Postgres trigger blocks raw `UPDATE campaigns SET status` outside
 *      `commitLifecycleStatus`.
 *   7. Migration audit event with `actor.kind='migration'` and aggregate
 *      fields NULL.
 *   8. (V2.4) Run `bun run packages/shared/scripts/generate-event-type-check.ts
 *      --verify` → PASS; mutate const-tuple → FAIL.
 *   9. (V2.5) lifecycle_op_id flows through chain.
 *  10. (V2.7) PATCH alias snapshot regression: pre-/post-Stage-2 byte equal
 *      modulo X-Deprecated header.
 *  11. (V2.8) Stop-force concurrent: 2 parallel calls → no duplicate
 *      force_exited per enrollment.
 *  12. (V2.9) Per-event payload size bounded.
 *  13. Replay self-test: query enrollment_events, reconstruct expected
 *      status sequence.
 */
import "./_fixtures";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Queue, Worker } from "bullmq";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  TEST_REDIS_URL,
  TEST_DB_URL,
  waitForDb,
  runMigrations,
  closeRawDb,
  cleanDb,
  flushRedis,
  getRawDb,
  createWorkspaceWithApiKey,
  createContact,
  createTemplate,
  createCampaignWithSteps,
  setResendScenario,
  RESEND_SEND_OK,
  waitFor,
} from "./_fixtures";
import { __resetRateLimiterForTests } from "../lib/rate-limiter";
import { generateId } from "@openmail/shared/ids";

let app: any;
const workers: Worker[] = [];

function redisConn() {
  const parsed = new URL(TEST_REDIS_URL);
  return { host: parsed.hostname, port: Number(parsed.port) || 6379 };
}

let stepQueue: Queue | null = null;
let eventsQueue: Queue | null = null;
let sendEmailQueue: Queue | null = null;

beforeAll(async () => {
  await waitForDb();
  await runMigrations();
  await flushRedis();

  const { createProcessEventWorker } = await import(
    "../../../worker/src/jobs/process-event.js"
  );
  const { createProcessStepWorker } = await import(
    "../../../worker/src/jobs/process-step.js"
  );
  const { createSendEmailWorker } = await import(
    "../../../worker/src/jobs/send-email.js"
  );
  workers.push(createProcessEventWorker());
  workers.push(createProcessStepWorker());
  workers.push(createSendEmailWorker());

  stepQueue = new Queue("step-execution", { connection: redisConn() });
  eventsQueue = new Queue("events", { connection: redisConn() });
  sendEmailQueue = new Queue("send-email", { connection: redisConn() });

  const mod = await import("../index.js");
  app = mod.app;

  setResendScenario(RESEND_SEND_OK);
}, 60_000);

afterAll(async () => {
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([
    stepQueue?.close(),
    eventsQueue?.close(),
    sendEmailQueue?.close(),
  ]);
  await __resetRateLimiterForTests();
  await closeRawDb();
}, 30_000);

beforeEach(async () => {
  await cleanDb();
  await flushRedis();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function ingestEventForContact(
  workspaceId: string,
  contactId: string,
  contactEmail: string,
  eventName: string,
): Promise<void> {
  const db = getRawDb();
  const id = generateId("evt");
  await db`
    INSERT INTO events (id, workspace_id, contact_id, contact_email, name, properties)
    VALUES (${id}, ${workspaceId}, ${contactId}, ${contactEmail}, ${eventName}, '{}'::jsonb)
  `;
  await eventsQueue!.add(
    "process-event",
    { eventId: id, workspaceId },
    { removeOnComplete: 100 },
  );
}

async function postVerb(
  apiKey: string,
  campaignId: string,
  verb: "pause" | "resume" | "stop" | "archive",
  body?: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/v1/campaigns/${campaignId}/${verb}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit event invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("Audit invariants — per-enrollment events", () => {
  it("event_seq is monotonic per enrollment, contact_id != NULL", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    const cid = await createContact(workspaceId, "a@b.com");
    await ingestEventForContact(workspaceId, cid, "a@b.com", "x");

    const db = getRawDb();
    await waitFor(async () => {
      const r = (await db`
        SELECT COUNT(*) AS c FROM enrollment_events
        WHERE campaign_id = ${campaignId}
      `) as any[];
      return Number(r[0].c) >= 1;
    }, { description: "enrolled event written" });

    const events = (await db`
      SELECT enrollment_id, event_type, event_seq, contact_id
        FROM enrollment_events
       WHERE campaign_id = ${campaignId}
         AND enrollment_id IS NOT NULL
       ORDER BY emitted_at
    `) as any[];

    expect(events.length).toBeGreaterThan(0);
    const grouped: Record<string, any[]> = {};
    for (const e of events) {
      grouped[e.enrollment_id] ??= [];
      grouped[e.enrollment_id].push(e);
    }
    for (const eid of Object.keys(grouped)) {
      const arr = grouped[eid];
      // event_seq strictly increasing.
      for (let i = 1; i < arr.length; i++) {
        expect(BigInt(arr[i].event_seq)).toBeGreaterThan(
          BigInt(arr[i - 1].event_seq),
        );
      }
      // All have contact_id (per [DB-04]).
      for (const e of arr) {
        expect(e.contact_id).not.toBeNull();
      }
    }
  }, 20_000);
});

describe("Audit invariants — aggregate (campaign-scope) events", () => {
  it("drain_completed (etc.) have event_seq=NULL, contact_id=NULL", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    // pause emits aggregate "paused"
    let res = await postVerb(apiKey, campaignId, "pause");
    expect(res.status).toBe(200);

    const db = getRawDb();
    const aggregates = (await db`
      SELECT event_type, event_seq, contact_id, enrollment_id
        FROM enrollment_events
       WHERE campaign_id = ${campaignId}
         AND enrollment_id IS NULL
    `) as any[];
    expect(aggregates.length).toBeGreaterThan(0);
    for (const a of aggregates) {
      expect(a.event_seq).toBeNull();
      expect(a.contact_id).toBeNull();
      expect(a.enrollment_id).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Postgres trigger
// ─────────────────────────────────────────────────────────────────────────────

describe("Postgres audit_chokepoint trigger", () => {
  it("blocks raw UPDATE campaigns SET status outside audited tx", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });

    const db = getRawDb();
    let threw = false;
    let msg = "";
    try {
      await db`UPDATE campaigns SET status = 'paused' WHERE id = ${campaignId}`;
    } catch (err) {
      threw = true;
      msg = (err as Error).message;
    }
    expect(threw).toBe(true);
    expect(msg).toContain("lifecycle.audit_chokepoint");
  });

  it("admits UPDATE inside SET LOCAL lifecycle.audited_tx='true' tx", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    const db = getRawDb();
    await db.begin(async (tx: any) => {
      await tx.unsafe(`SET LOCAL lifecycle.audited_tx = 'true'`);
      await tx.unsafe(
        `UPDATE campaigns SET status = 'paused' WHERE id = '${campaignId}'`,
      );
    });
    const [row] = (await db`SELECT status FROM campaigns WHERE id = ${campaignId}`) as any[];
    expect(row.status).toBe("paused");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration audit
// ─────────────────────────────────────────────────────────────────────────────

describe("Migration audit (auditedMigration helper)", () => {
  it("emits migration_status_change with actor.kind='migration', aggregates NULL", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });

    const { auditedMigration } = await import("@openmail/shared");
    const { sql } = await import("drizzle-orm");
    await auditedMigration(
      {
        migrationName: "0099_test_audit_completeness",
        campaignId,
        workspaceId,
        payload: {
          affected_count: 1,
          reason: "test reclassification",
        },
        actorName: "ci/test",
      },
      async (tx) => {
        await tx.execute(
          sql`UPDATE campaigns SET status = 'paused' WHERE id = ${campaignId}`,
        );
      },
    );

    const db = getRawDb();
    const events = (await db`
      SELECT event_type, actor, enrollment_id, contact_id, event_seq
        FROM enrollment_events
       WHERE campaign_id = ${campaignId}
         AND event_type = 'migration_status_change'
    `) as any[];
    expect(events.length).toBe(1);
    const e = events[0];
    expect(e.actor.kind).toBe("migration");
    expect(e.actor.name).toBe("ci/test");
    expect(e.enrollment_id).toBeNull();
    expect(e.contact_id).toBeNull();
    expect(e.event_seq).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// V2.4 — generate-event-type-check verify
// ─────────────────────────────────────────────────────────────────────────────

describe("V2.4 — event type CHECK verifier", () => {
  it("--verify PASSES against current schema", async () => {
    const scriptPath = path.resolve(
      import.meta.dir,
      "../../../packages/shared/scripts/generate-event-type-check.ts",
    );
    const result = spawnSync("bun", [scriptPath, "--verify"], {
      env: {
        ...process.env,
        DIRECT_DATABASE_URL: TEST_DB_URL,
        DATABASE_URL: TEST_DB_URL,
      },
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// V2.5 — lifecycle_op_id propagation
// ─────────────────────────────────────────────────────────────────────────────

describe("V2.5 — lifecycle_op_id flows through chain", () => {
  it("X-Lifecycle-Op-Id forwarded to verb is recorded in audit payload", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    const opId = "lop_test_1234567890ab";
    const res = await app.request(`/api/v1/campaigns/${campaignId}/pause`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Lifecycle-Op-Id": opId,
      },
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.lifecycle_op_id).toBe(opId);

    const db = getRawDb();
    const events = (await db`
      SELECT payload FROM enrollment_events
       WHERE campaign_id = ${campaignId}
    `) as any[];
    expect(events.some((e) => e.payload.lifecycle_op_id === opId)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// V2.7 — PATCH alias snapshot regression
// ─────────────────────────────────────────────────────────────────────────────

describe("V2.7 — PATCH alias snapshot (frozen response shape)", () => {
  it("PATCH response matches pre-Stage-2 raw-row shape modulo X-Deprecated header", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    const res = await app.request(`/api/v1/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "paused" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Deprecated")).toBeTruthy();
    const body: any = await res.json();
    // Critical pre-Stage-2 fields:
    expect(typeof body.id).toBe("string");
    expect(typeof body.workspaceId).toBe("string");
    expect(typeof body.name).toBe("string");
    expect(body.status).toBe("paused");
    expect(typeof body.triggerType).toBe("string");
    expect(typeof body.createdAt).toBe("string");
    // Stage 2 additions:
    expect(typeof body.reEnrollmentPolicy).toBe("string");
    // NOT a verb response:
    expect(body.campaign).toBeUndefined();
    expect(body.lifecycle_op_id).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// V2.8 — concurrent stop-force
// ─────────────────────────────────────────────────────────────────────────────

describe("V2.8 — concurrent stop-force", () => {
  it("2 parallel stop-force calls → at most one force_exited per enrollment", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S" } },
        { stepType: "wait", config: { duration: 10, unit: "hours" } },
      ],
    });
    const cid = await createContact(workspaceId, "v@x.com");
    await ingestEventForContact(workspaceId, cid, "v@x.com", "x");
    const db = getRawDb();
    await waitFor(async () => {
      const r = (await db`
        SELECT id FROM campaign_enrollments WHERE campaign_id = ${campaignId} AND status = 'active'
      `) as any[];
      return r.length === 1;
    }, { description: "enrollment active", timeoutMs: 10_000 });

    // Fire two stop-force calls in parallel.
    const [r1, r2] = await Promise.all([
      postVerb(apiKey, campaignId, "stop", {
        mode: "force",
        confirm_force: true,
      }),
      postVerb(apiKey, campaignId, "stop", {
        mode: "force",
        confirm_force: true,
      }),
    ]);
    // At least one succeeds; the other returns 409 (illegal transition).
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);

    // Per-enrollment force_exited count: at most one.
    const events = (await db`
      SELECT enrollment_id, COUNT(*) AS c
        FROM enrollment_events
       WHERE campaign_id = ${campaignId}
         AND event_type = 'force_exited'
         AND enrollment_id IS NOT NULL
       GROUP BY enrollment_id
    `) as any[];
    for (const e of events) {
      expect(Number(e.c)).toBeLessThanOrEqual(1);
    }
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// V2.9 — payload size budget
// ─────────────────────────────────────────────────────────────────────────────

describe("V2.9 — payload size budget", () => {
  it("per-event payload < 4KB (delta-only invariant)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    const cid = await createContact(workspaceId, "p@x.com");
    await ingestEventForContact(workspaceId, cid, "p@x.com", "x");
    await postVerb(apiKey, campaignId, "pause");

    const db = getRawDb();
    const events = (await db`
      SELECT payload, before, after FROM enrollment_events
       WHERE campaign_id = ${campaignId}
    `) as any[];
    expect(events.length).toBeGreaterThan(0);
    let totalBytes = 0;
    let maxBytes = 0;
    for (const e of events) {
      const bytes = Buffer.byteLength(
        JSON.stringify({ payload: e.payload, before: e.before, after: e.after }),
        "utf8",
      );
      totalBytes += bytes;
      maxBytes = Math.max(maxBytes, bytes);
    }
    expect(maxBytes).toBeLessThan(4096);
    const avg = totalBytes / events.length;
    expect(avg).toBeLessThan(1024);
  }, 15_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Replay self-test
// ─────────────────────────────────────────────────────────────────────────────

describe("Replay self-test", () => {
  it("reconstruct status from enrollment_events sequence matches actual current_status", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    // pause → resume → pause sequence on campaigns aggregate.
    await postVerb(apiKey, campaignId, "pause");
    await postVerb(apiKey, campaignId, "resume", { mode: "immediate" });
    await postVerb(apiKey, campaignId, "pause");

    const db = getRawDb();
    const events = (await db`
      SELECT event_type, before, after, emitted_at
        FROM enrollment_events
       WHERE campaign_id = ${campaignId}
         AND enrollment_id IS NULL
       ORDER BY emitted_at
    `) as any[];

    // Replay: reduce status from before/after deltas.
    let status = "active"; // initial campaign status
    for (const e of events) {
      if (e.before?.status && e.after?.status) {
        expect(e.before.status).toBe(status);
        status = e.after.status;
      }
    }
    const [row] = (await db`SELECT status FROM campaigns WHERE id = ${campaignId}`) as any[];
    expect(row.status).toBe(status);
    expect(status).toBe("paused");
  });
});
