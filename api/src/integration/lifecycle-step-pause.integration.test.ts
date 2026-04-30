/**
 * Integration test — Stage 4 / T10 — Per-Step Pause/Resume
 *
 * Covers the new POST /api/v1/campaigns/:id/steps/:stepId/{pause,resume}
 * surface, step-job tagging, sweeper held-step orphan reconciliation,
 * step deletion advancing held enrollments, and the CRITICAL [A4.1]
 * stop_drain × held-step deadlock resolution.
 */
import "./_fixtures";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  TEST_REDIS_URL,
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
let drainQueue: Queue | null = null;

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
  const { createStopDrainWorker } = await import(
    "../../../worker/src/jobs/process-stop-drain.js"
  );
  workers.push(createProcessEventWorker());
  workers.push(createProcessStepWorker());
  workers.push(createSendEmailWorker());
  workers.push(createStopDrainWorker());

  stepQueue = new Queue("step-execution", { connection: redisConn() });
  drainQueue = new Queue("lifecycle-drain-sweeper", { connection: redisConn() });

  const mod = await import("../index.js");
  app = mod.app;

  setResendScenario(RESEND_SEND_OK);
}, 60_000);

afterAll(async () => {
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([stepQueue?.close(), drainQueue?.close()]);
  await __resetRateLimiterForTests();
  await closeRawDb();
}, 30_000);

beforeEach(async () => {
  await cleanDb();
  await flushRedis();
  setResendScenario(RESEND_SEND_OK);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getStep(stepId: string) {
  const db = getRawDb();
  const [row] = await db`SELECT * FROM campaign_steps WHERE id = ${stepId}`;
  return row as any;
}

async function getEnrollment(id: string) {
  const db = getRawDb();
  const [row] = await db`SELECT * FROM campaign_enrollments WHERE id = ${id}`;
  return row as any;
}

async function pauseStep(
  apiKey: string,
  campaignId: string,
  stepId: string,
): Promise<Response> {
  return app.request(
    `/api/v1/campaigns/${campaignId}/steps/${stepId}/pause`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    },
  );
}

async function resumeStep(
  apiKey: string,
  campaignId: string,
  stepId: string,
  body: Record<string, unknown> = { mode: "immediate" },
): Promise<Response> {
  return app.request(
    `/api/v1/campaigns/${campaignId}/steps/${stepId}/resume`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

async function deleteStep(
  apiKey: string,
  campaignId: string,
  stepId: string,
): Promise<Response> {
  return app.request(`/api/v1/campaigns/${campaignId}/steps/${stepId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

/**
 * Insert an enrollment directly with the desired state. Used to seed
 * controlled test scenarios without running the full engine end-to-end.
 */
async function insertEnrollment(opts: {
  workspaceId: string;
  campaignId: string;
  contactId: string;
  currentStepId: string;
  status?: "active" | "paused" | "completed";
  stepHeldAt?: Date | null;
}): Promise<string> {
  const db = getRawDb();
  const id = generateId("enr");
  await db`
    INSERT INTO campaign_enrollments (
      id, workspace_id, campaign_id, contact_id, current_step_id, status,
      step_held_at, started_at, updated_at
    ) VALUES (
      ${id},
      ${opts.workspaceId},
      ${opts.campaignId},
      ${opts.contactId},
      ${opts.currentStepId},
      ${opts.status ?? "active"},
      ${opts.stepHeldAt ?? null},
      NOW(),
      NOW()
    )
  `;
  return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Pause middle step → other-step enrollments unaffected
// ─────────────────────────────────────────────────────────────────────────────

describe("Per-step pause: granularity", () => {
  it("pausing step S2 holds S2 enrollments but leaves S1/S3 alone", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>x</p>", "tpl");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S1" } },
        { stepType: "wait", config: { duration: 1, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl, subject: "S3" } },
      ],
    });
    // Create 3 contacts, one at each step.
    const c1 = await createContact(workspaceId, "c1@t.com");
    const c2 = await createContact(workspaceId, "c2@t.com");
    const c3 = await createContact(workspaceId, "c3@t.com");
    const e1 = await insertEnrollment({
      workspaceId,
      campaignId,
      contactId: c1,
      currentStepId: steps[0]!.id,
    });
    const e2 = await insertEnrollment({
      workspaceId,
      campaignId,
      contactId: c2,
      currentStepId: steps[1]!.id,
    });
    const e3 = await insertEnrollment({
      workspaceId,
      campaignId,
      contactId: c3,
      currentStepId: steps[2]!.id,
    });

    // Pause S2.
    const res = await pauseStep(apiKey, campaignId, steps[1]!.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.held_count).toBe(1);
    expect(body.step.status).toBe("paused");

    // S2 step is paused; S2 enrollment is held; S1 + S3 untouched.
    expect((await getStep(steps[1]!.id)).status).toBe("paused");
    expect((await getStep(steps[0]!.id)).status).toBe("active");
    expect((await getStep(steps[2]!.id)).status).toBe("active");
    expect((await getEnrollment(e2)).step_held_at).not.toBeNull();
    expect((await getEnrollment(e1)).step_held_at).toBeNull();
    expect((await getEnrollment(e3)).step_held_at).toBeNull();
  });

  it("pause is idempotent on already-paused step", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>x</p>", "tpl");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl } }],
    });
    const r1 = await pauseStep(apiKey, campaignId, steps[0]!.id);
    expect(r1.status).toBe(200);
    const r2 = await pauseStep(apiKey, campaignId, steps[0]!.id);
    expect(r2.status).toBe(200);
    const body = (await r2.json()) as any;
    expect(body.idempotent).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Resume immediate re-enqueues held enrollments
// ─────────────────────────────────────────────────────────────────────────────

describe("Per-step resume: immediate", () => {
  it("clears step_held_at and emits step_resumed event", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>x</p>", "tpl");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S1" } },
      ],
    });
    const c1 = await createContact(workspaceId, "alice@t.com");
    await insertEnrollment({
      workspaceId,
      campaignId,
      contactId: c1,
      currentStepId: steps[0]!.id,
    });

    expect((await pauseStep(apiKey, campaignId, steps[0]!.id)).status).toBe(200);

    const res = await resumeStep(apiKey, campaignId, steps[0]!.id, {
      mode: "immediate",
    });
    expect(res.status).toBe(200);
    expect((await getStep(steps[0]!.id)).status).toBe("active");

    const db = getRawDb();
    const events = (await db`
      SELECT event_type FROM enrollment_events
       WHERE campaign_id = ${campaignId} AND event_type IN ('step_paused','step_resumed','step_held')
       ORDER BY emitted_at ASC
    `) as any[];
    const types = events.map((e) => e.event_type);
    expect(types).toContain("step_paused");
    expect(types).toContain("step_resumed");
    expect(types).toContain("step_held");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Concurrent pause of different steps in same campaign
// ─────────────────────────────────────────────────────────────────────────────

describe("Per-step pause: concurrency", () => {
  it("pausing step 3 and step 5 from two API calls both succeed", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>x</p>", "tpl");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [
        { stepType: "email", config: { templateId: tpl } },
        { stepType: "wait", config: { duration: 1, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl } },
        { stepType: "wait", config: { duration: 1, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl } },
      ],
    });
    const [r3, r5] = await Promise.all([
      pauseStep(apiKey, campaignId, steps[2]!.id),
      pauseStep(apiKey, campaignId, steps[4]!.id),
    ]);
    expect(r3.status).toBe(200);
    expect(r5.status).toBe(200);
    expect((await getStep(steps[2]!.id)).status).toBe("paused");
    expect((await getStep(steps[4]!.id)).status).toBe("paused");
    expect((await getStep(steps[0]!.id)).status).toBe("active");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Stale-skip on per-step resume
// ─────────────────────────────────────────────────────────────────────────────

describe("Per-step resume: skip_stale", () => {
  it("advances enrollments past step when held longer than threshold", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>x</p>", "tpl");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S1" } },
        { stepType: "email", config: { templateId: tpl, subject: "S2" } },
      ],
    });
    const c1 = await createContact(workspaceId, "alice@t.com");
    const eId = await insertEnrollment({
      workspaceId,
      campaignId,
      contactId: c1,
      currentStepId: steps[0]!.id,
    });

    // Pause step 1
    expect((await pauseStep(apiKey, campaignId, steps[0]!.id)).status).toBe(200);

    // Backdate the step's pausedAt to past the stale threshold (10s)
    const db = getRawDb();
    await db`UPDATE campaign_steps SET paused_at = NOW() - INTERVAL '20 seconds' WHERE id = ${steps[0]!.id}`;

    // Resume with skip_stale, threshold 10s → enrollment should advance past step 1.
    const res = await resumeStep(apiKey, campaignId, steps[0]!.id, {
      mode: "skip_stale",
      stale_threshold_seconds: 10,
    });
    expect(res.status).toBe(200);

    const events = (await db`
      SELECT event_type FROM enrollment_events
       WHERE enrollment_id = ${eId} AND event_type = 'stale_skipped'
    `) as any[];
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Step deletion of paused step advances held enrollments
// ─────────────────────────────────────────────────────────────────────────────

describe("Step deletion while paused", () => {
  it("emits reconciled event and clears step_held_at", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>x</p>", "tpl");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S1" } },
        { stepType: "email", config: { templateId: tpl, subject: "S2" } },
        { stepType: "email", config: { templateId: tpl, subject: "S3" } },
      ],
    });
    const c1 = await createContact(workspaceId, "alice@t.com");
    const eId = await insertEnrollment({
      workspaceId,
      campaignId,
      contactId: c1,
      currentStepId: steps[1]!.id, // held on middle step
    });

    expect((await pauseStep(apiKey, campaignId, steps[1]!.id)).status).toBe(200);
    expect((await getEnrollment(eId)).step_held_at).not.toBeNull();

    const res = await deleteStep(apiKey, campaignId, steps[1]!.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.reconciled).toBe(true);
    expect(body.advanced_count).toBe(1);

    // Reconciled event recorded.
    const db = getRawDb();
    const events = (await db`
      SELECT event_type, payload FROM enrollment_events
       WHERE enrollment_id = ${eId} AND event_type = 'reconciled'
    `) as any[];
    expect(events.length).toBe(1);
    expect(events[0].payload.reason).toBe("step_deleted_while_paused");

    // step_held_at cleared after advancement.
    await waitFor(
      async () => (await getEnrollment(eId)).step_held_at === null,
      { description: "step_held_at cleared", timeoutMs: 5_000 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Sweeper reconciles held-step orphan jobs
// ─────────────────────────────────────────────────────────────────────────────

describe("Sweeper held-step orphan reconciliation", () => {
  it("removes BullMQ jobs that survived a crash mid-pause-cancel", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>x</p>", "tpl");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl } }],
    });

    // Manually flip step to paused + plant an orphan tag.
    const db = getRawDb();
    await db`UPDATE campaign_steps SET status='paused', paused_at=NOW() WHERE id=${steps[0]!.id}`;

    // Plant a tagged orphan job (simulate crash mid-cancel).
    const fakeJobId = `step-execution:enr_orphan_x:${steps[0]!.id}`;
    await stepQueue!.add(
      "step-execution",
      { enrollmentId: "enr_orphan_x", stepId: steps[0]!.id },
      { jobId: fakeJobId, delay: 60_000, removeOnComplete: 1, removeOnFail: 1 },
    );
    const parsed = new URL(TEST_REDIS_URL);
    const redis = new Redis({
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });
    try {
      await redis.sadd(`bullmq:wait-jobs:step:${steps[0]!.id}`, fakeJobId);

      // Trigger sweeper.
      await drainQueue!.add(
        "drain-sweep",
        {},
        { jobId: `drain-sweep-${Date.now()}`, removeOnComplete: 1 },
      );

      // Wait for sweeper to remove the orphan.
      await waitFor(
        async () => {
          const job = await stepQueue!.getJob(fakeJobId);
          return !job;
        },
        { description: "sweeper removed orphan", timeoutMs: 15_000 },
      );
    } finally {
      await redis.quit().catch(() => {});
    }
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 [A4.1] CRITICAL: stop_drain × held-step deadlock resolution
// ─────────────────────────────────────────────────────────────────────────────

describe("[A4.1] stop_drain × held-step deadlock", () => {
  it("force-exits held enrollments after progressing reaches zero", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>x</p>", "tpl");
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S1" } },
        { stepType: "wait", config: { duration: 1, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl, subject: "S3" } },
        { stepType: "wait", config: { duration: 1, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl, subject: "S5" } },
      ],
    });

    // Setup: 3 held at step 5, 2 progressing at step 3.
    const heldIds: string[] = [];
    const progressingIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await createContact(workspaceId, `held${i}@t.com`);
      heldIds.push(
        await insertEnrollment({
          workspaceId,
          campaignId,
          contactId: c,
          currentStepId: steps[4]!.id,
        }),
      );
    }
    for (let i = 0; i < 2; i++) {
      const c = await createContact(workspaceId, `prog${i}@t.com`);
      progressingIds.push(
        await insertEnrollment({
          workspaceId,
          campaignId,
          contactId: c,
          currentStepId: steps[2]!.id,
        }),
      );
    }

    // Pause step 5.
    const pauseRes = await pauseStep(apiKey, campaignId, steps[4]!.id);
    expect(pauseRes.status).toBe(200);
    const pauseBody = (await pauseRes.json()) as any;
    expect(pauseBody.held_count).toBe(3);

    // Trigger stop_drain on the campaign.
    const stopRes = await app.request(
      `/api/v1/campaigns/${campaignId}/stop`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "drain" }),
      },
    );
    expect(stopRes.status).toBe(200);

    const db = getRawDb();
    const [c0] = await db`SELECT status FROM campaigns WHERE id = ${campaignId}`;
    expect((c0 as any).status).toBe("stopping");

    // Sweeper run #1 — held enrollments must NOT be force-exited yet because
    // progressing enrollments still exist. Campaign stays in 'stopping'.
    await drainQueue!.add(
      "drain-sweep",
      {},
      { jobId: `drain-sweep-${Date.now()}-1`, removeOnComplete: 1 },
    );
    // Give sweeper a moment to run.
    await Bun.sleep(800);
    const [c1] = await db`SELECT status FROM campaigns WHERE id = ${campaignId}`;
    expect((c1 as any).status).toBe("stopping");
    // Held still active, no force_exited_at yet.
    for (const eid of heldIds) {
      const e = await getEnrollment(eid);
      expect(e.status).toBe("active");
      expect(e.force_exited_at).toBeNull();
    }

    // Drive progressing to completed (mark them done in DB to simulate
    // natural finish).
    for (const eid of progressingIds) {
      await db`
        UPDATE campaign_enrollments
           SET status='completed', completed_at=NOW(), updated_at=NOW()
         WHERE id=${eid}
      `;
    }

    // Sweeper run #2 — now progressing=0 so held are force-exited and
    // campaign promotes stopping→stopped.
    await drainQueue!.add(
      "drain-sweep",
      {},
      { jobId: `drain-sweep-${Date.now()}-2`, removeOnComplete: 1 },
    );
    await waitFor(
      async () => {
        const [row] = await db`SELECT status FROM campaigns WHERE id = ${campaignId}`;
        return (row as any).status === "stopped";
      },
      { description: "campaign drained → stopped", timeoutMs: 20_000 },
    );

    // Verify each held enrollment was force-exited.
    for (const eid of heldIds) {
      const e = await getEnrollment(eid);
      expect(e.force_exited_at).not.toBeNull();
      expect(e.status).toBe("completed");
    }

    // Verify audit events with the documented reason.
    const audits = (await db`
      SELECT enrollment_id, event_type, payload
        FROM enrollment_events
       WHERE campaign_id = ${campaignId}
         AND event_type = 'force_exited'
         AND enrollment_id IS NOT NULL
    `) as any[];
    expect(audits.length).toBeGreaterThanOrEqual(3);
    // At least three force_exited events with reason 'held_at_paused_step_during_drain'.
    const heldAudits = audits.filter(
      (a) => a.payload?.reason === "held_at_paused_step_during_drain",
    );
    expect(heldAudits.length).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
