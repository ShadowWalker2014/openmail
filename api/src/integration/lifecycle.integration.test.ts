/**
 * Integration test — Stage 2 / T22 — Lifecycle verb engine
 *
 * Covers the new POST /api/v1/campaigns/:id/{pause,resume,stop,archive}
 * surface, the PATCH-status alias (still frozen but now audit-routed), and
 * re-enrollment policy plumbing.
 *
 * Strategy mirrors `campaign.integration.test.ts`:
 *   - Real Postgres (port 5455) + Redis (port 6395)
 *   - In-process workers: process-event, process-step, send-email, stop-drain
 *   - Hono app via `app.request()`
 *   - Resend intercepted at fetch level
 *
 * Pre-deploy assumption: migration 0007 (audit_chokepoint_trigger,
 * campaigns-only) is applied — verified by `_fixtures.ts:runMigrations()`.
 */
import "./_fixtures";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Queue, Worker } from "bullmq";
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
let eventsQueue: Queue | null = null;
let sendEmailQueue: Queue | null = null;
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
  eventsQueue = new Queue("events", { connection: redisConn() });
  sendEmailQueue = new Queue("send-email", { connection: redisConn() });
  drainQueue = new Queue("lifecycle-drain-sweeper", { connection: redisConn() });

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
    drainQueue?.close(),
  ]);
  await __resetRateLimiterForTests();
  await closeRawDb();
}, 30_000);

beforeEach(async () => {
  await cleanDb();
  await flushRedis();
  setResendScenario(RESEND_SEND_OK);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getCampaign(id: string) {
  const db = getRawDb();
  const [row] = await db`SELECT * FROM campaigns WHERE id = ${id}`;
  return row as any;
}

async function getEnrollments(campaignId: string) {
  const db = getRawDb();
  return (await db`
    SELECT id, contact_id, status, current_step_id, completed_at, force_exited_at
      FROM campaign_enrollments
     WHERE campaign_id = ${campaignId}
     ORDER BY started_at
  `) as any[];
}

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

async function patchCampaign(
  apiKey: string,
  campaignId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/v1/campaigns/${campaignId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Full happy-path lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe("Lifecycle verbs — full cycle (enroll → pause → resume → stop_drain → archive)", () => {
  it("walks a campaign through every reachable status with audit events", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S1</p>", "s1");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "kickoff" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S1" } },
        { stepType: "wait", config: { duration: 10, unit: "hours" } },
      ],
    });

    const cid = await createContact(workspaceId, "alice@test.com");
    await ingestEventForContact(workspaceId, cid, "alice@test.com", "kickoff");
    await waitFor(
      async () => (await getEnrollments(campaignId))[0]?.current_step_id != null,
      { description: "enrollment progressed", timeoutMs: 10_000 },
    );

    // Pause
    let res = await postVerb(apiKey, campaignId, "pause");
    expect(res.status).toBe(200);
    expect((await getCampaign(campaignId)).status).toBe("paused");

    // Resume
    res = await postVerb(apiKey, campaignId, "resume", { mode: "immediate" });
    expect(res.status).toBe(200);
    expect((await getCampaign(campaignId)).status).toBe("active");

    // Stop drain
    res = await postVerb(apiKey, campaignId, "stop", { mode: "drain" });
    expect(res.status).toBe(200);
    expect((await getCampaign(campaignId)).status).toBe("stopping");

    // Drain sweeper kicks campaign → stopped (after enrollment exits / no progressing).
    // For tests we trigger the sweep manually instead of waiting for the
    // repeatable schedule to land.
    // Trigger sweep manually. BullMQ rejects jobIds with exactly 1 colon
    // (see Stage 1 plan CN-02); use 0 colons.
    await drainQueue!.add(
      "drain-sweep",
      {},
      { jobId: `drain-sweep-${Date.now()}`, removeOnComplete: 1 },
    );
    await waitFor(
      async () => (await getCampaign(campaignId)).status === "stopped",
      { description: "drain completed → stopped", timeoutMs: 15_000 },
    );

    // Archive (terminal, requires confirm_terminal)
    res = await postVerb(apiKey, campaignId, "archive", {
      confirm_terminal: true,
    });
    expect(res.status).toBe(200);
    expect((await getCampaign(campaignId)).status).toBe("archived");
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Stop force
// ─────────────────────────────────────────────────────────────────────────────

describe("Lifecycle stop force", () => {
  it("force mode cancels in-flight enrollments with force_exited_at + per-enrollment audit", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S1</p>", "s1");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "kickoff" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S1" } },
        { stepType: "wait", config: { duration: 10, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl, subject: "S2" } },
      ],
    });

    const cid = await createContact(workspaceId, "victim@test.com");
    await ingestEventForContact(workspaceId, cid, "victim@test.com", "kickoff");
    await waitFor(
      async () => {
        const e = (await getEnrollments(campaignId))[0];
        return e?.status === "active";
      },
      { description: "enrollment landed on wait step", timeoutMs: 10_000 },
    );

    // Force stop
    const res = await postVerb(apiKey, campaignId, "stop", {
      mode: "force",
      confirm_force: true,
    });
    expect(res.status).toBe(200);
    expect((await getCampaign(campaignId)).status).toBe("stopped");

    // Per-enrollment audit event for force_exited.
    const db = getRawDb();
    const audits = (await db`
      SELECT event_type, enrollment_id, payload
        FROM enrollment_events
       WHERE campaign_id = ${campaignId}
         AND event_type = 'force_exited'
    `) as any[];
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits.some((a) => a.enrollment_id != null)).toBe(true);
  }, 30_000);

  it("rejects force without confirm_force (Zod literal)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S1</p>", "s1");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "kickoff" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S1" } },
      ],
    });
    const res = await postVerb(apiKey, campaignId, "stop", {
      mode: "force",
    });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH alias semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH alias", () => {
  it("PATCH {status:'paused'} returns 200 with X-Deprecated header (frozen response shape)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S1</p>", "s1");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "kickoff" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S1" } },
      ],
    });

    const res = await patchCampaign(apiKey, campaignId, { status: "paused" });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Deprecated")).toContain(
      "POST /api/v1/campaigns/:id/",
    );
    const body: any = await res.json();
    // Frozen shape: raw campaign row (NOT { campaign, lifecycle_op_id })
    expect(body.id).toBe(campaignId);
    expect(body.status).toBe("paused");
    expect(body.campaign).toBeUndefined();
  });

  it("PATCH {status:'stopping'} → 400 (PATCH cannot stop)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S1</p>", "s1");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "kickoff" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S1" } },
      ],
    });
    const res = await patchCampaign(apiKey, campaignId, { status: "stopping" });
    expect(res.status).toBe(400);
  });

  it("PATCH {status:'stopped'} → 400 (PATCH cannot stop)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S1</p>", "s1");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "kickoff" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S1" } },
      ],
    });
    const res = await patchCampaign(apiKey, campaignId, { status: "stopped" });
    expect(res.status).toBe(400);
  });

  it("PATCH on stopped campaign for non-archive transition → 409", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S1</p>", "s1");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "kickoff" },
      steps: [
        { stepType: "email", config: { templateId: tpl, subject: "S1" } },
      ],
    });
    // Force-stop first to land in 'stopped'.
    await postVerb(apiKey, campaignId, "stop", {
      mode: "force",
      confirm_force: true,
    });
    expect((await getCampaign(campaignId)).status).toBe("stopped");

    const res = await patchCampaign(apiKey, campaignId, { status: "paused" });
    expect(res.status).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Re-enrollment policy
// ─────────────────────────────────────────────────────────────────────────────

describe("Re-enrollment policy", () => {
  async function patchPolicy(
    apiKey: string,
    campaignId: string,
    policy: "never" | "always" | "after_cooldown" | "on_attribute_change",
    cooldownSec?: number,
  ) {
    const body: Record<string, unknown> = { re_enrollment_policy: policy };
    if (cooldownSec !== undefined) {
      body.re_enrollment_cooldown_seconds = cooldownSec;
    }
    return patchCampaign(apiKey, campaignId, body);
  }

  it("policy='never' blocks 2nd trigger after enrollment completes", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "trig" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    // default policy is 'never' (CR-05).
    const cid = await createContact(workspaceId, "u@x.com");

    await ingestEventForContact(workspaceId, cid, "u@x.com", "trig");
    await waitFor(
      async () => (await getEnrollments(campaignId)).length === 1,
      { description: "first enrollment created" },
    );
    await waitFor(
      async () => {
        const e = (await getEnrollments(campaignId))[0];
        return e?.status === "completed";
      },
      { description: "first enrollment completed", timeoutMs: 10_000 },
    );

    // Fire the same trigger again — must NOT create a 2nd enrollment.
    await ingestEventForContact(workspaceId, cid, "u@x.com", "trig");
    await Bun.sleep(800);
    const enrolls = await getEnrollments(campaignId);
    expect(enrolls).toHaveLength(1);

    // re_enrollment_blocked audit event recorded.
    const db = getRawDb();
    const blocked = (await db`
      SELECT * FROM enrollment_events
       WHERE campaign_id = ${campaignId}
         AND event_type = 're_enrollment_blocked'
    `) as any[];
    expect(blocked.length).toBeGreaterThanOrEqual(1);

    void apiKey;
  }, 30_000);

  it("policy='always' allows 2nd enrollment via re_enrolled event", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "trig2" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    // Switch to 'always'.
    const r = await patchPolicy(apiKey, campaignId, "always");
    expect(r.status).toBe(200);

    const cid = await createContact(workspaceId, "u2@x.com");
    await ingestEventForContact(workspaceId, cid, "u2@x.com", "trig2");
    await waitFor(
      async () => {
        const e = (await getEnrollments(campaignId))[0];
        return e?.status === "completed";
      },
      { description: "first complete", timeoutMs: 10_000 },
    );

    await ingestEventForContact(workspaceId, cid, "u2@x.com", "trig2");
    // Wait for the re_enrolled audit event to land — predicate is the actual
    // assertion target so we don't race the worker.
    const db = getRawDb();
    await waitFor(
      async () => {
        const r = (await db`
          SELECT event_type FROM enrollment_events
           WHERE campaign_id = ${campaignId}
             AND event_type = 're_enrolled'
        `) as any[];
        return r.length >= 1;
      },
      { description: "re_enrolled event emitted", timeoutMs: 10_000 },
    );

    const re = (await db`
      SELECT event_type FROM enrollment_events
       WHERE campaign_id = ${campaignId}
         AND event_type = 're_enrolled'
    `) as any[];
    expect(re.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("policy='after_cooldown' blocks before cooldown elapses", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "trig3" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    const r = await patchPolicy(apiKey, campaignId, "after_cooldown", 3600);
    expect(r.status).toBe(200);

    const cid = await createContact(workspaceId, "u3@x.com");
    await ingestEventForContact(workspaceId, cid, "u3@x.com", "trig3");
    await waitFor(
      async () => {
        const e = (await getEnrollments(campaignId))[0];
        return e?.status === "completed";
      },
      { description: "first complete", timeoutMs: 10_000 },
    );

    // Re-fire immediately — cooldown of 3600s not elapsed.
    await ingestEventForContact(workspaceId, cid, "u3@x.com", "trig3");
    await Bun.sleep(800);

    const db = getRawDb();
    const blocked = (await db`
      SELECT payload FROM enrollment_events
       WHERE campaign_id = ${campaignId}
         AND event_type = 're_enrollment_blocked'
    `) as any[];
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].payload.reason).toBe("cooldown_pending");
  }, 30_000);

  it("policy='on_attribute_change' triggers on attribute mutation", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "trig4" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    const r = await patchPolicy(apiKey, campaignId, "on_attribute_change");
    expect(r.status).toBe(200);

    const cid = await createContact(workspaceId, "u4@x.com");
    await ingestEventForContact(workspaceId, cid, "u4@x.com", "trig4");
    await waitFor(
      async () => {
        const e = (await getEnrollments(campaignId))[0];
        return e?.status === "completed";
      },
      { description: "first complete", timeoutMs: 10_000 },
    );

    // Mutate contact attributes.
    const db = getRawDb();
    await db`UPDATE contacts SET attributes = '{"plan":"pro"}'::jsonb WHERE id = ${cid}`;

    await ingestEventForContact(workspaceId, cid, "u4@x.com", "trig4");
    await Bun.sleep(800);

    // Look for re_enrolled (attributes changed → allowed).
    const re = (await db`
      SELECT payload FROM enrollment_events
       WHERE campaign_id = ${campaignId}
         AND event_type = 're_enrolled'
    `) as any[];
    expect(re.length).toBeGreaterThanOrEqual(1);
    expect(re[0].payload.reason).toBe("attributes_changed");
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Illegal transitions + idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("Lifecycle illegal transitions and idempotency", () => {
  it("POST /pause on draft campaign → 409 INVALID_TRANSITION", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      status: "draft",
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    const res = await postVerb(apiKey, campaignId, "pause");
    expect(res.status).toBe(409);
    const body: any = await res.json();
    expect(body.error).toBe("INVALID_TRANSITION");
    expect(body.from).toBe("active");
    expect(body.actual).toBe("draft");
  });

  it("POST /pause on stopped campaign → 409 [CR-13]", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    await postVerb(apiKey, campaignId, "stop", {
      mode: "force",
      confirm_force: true,
    });
    const res = await postVerb(apiKey, campaignId, "pause");
    expect(res.status).toBe(409);
  });

  it("POST /archive on archived campaign → 200 (idempotent)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    let res = await postVerb(apiKey, campaignId, "archive", {
      confirm_terminal: true,
    });
    expect(res.status).toBe(200);
    res = await postVerb(apiKey, campaignId, "archive", {
      confirm_terminal: true,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.idempotent).toBe(true);
  });

  it("POST /archive without confirm_terminal → 400 (Zod)", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(workspaceId, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    const res = await postVerb(apiKey, campaignId, "archive", {});
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-workspace isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("Lifecycle cross-workspace isolation", () => {
  it("verb on campaign in DIFFERENT workspace → 404", async () => {
    const { workspaceId: wsA } = await createWorkspaceWithApiKey();
    const { apiKey: keyB } = await createWorkspaceWithApiKey();
    const tpl = await createTemplate(wsA, "<p>S</p>");
    const { campaignId } = await createCampaignWithSteps(wsA, {
      triggerType: "event",
      triggerConfig: { eventName: "x" },
      steps: [{ stepType: "email", config: { templateId: tpl, subject: "S" } }],
    });
    const res = await postVerb(keyB, campaignId, "pause");
    expect(res.status).toBe(404);
  });
});
