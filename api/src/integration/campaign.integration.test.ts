/**
 * Integration test — Stage 1 / T11 — Campaign multi-step engine
 *
 * Covers the end-to-end behaviour of the campaign engine after Groups A–C:
 *   - 3-step campaign (email → wait → email) with delayed BullMQ job
 *   - Enrollment via process-event (real worker)
 *   - Step 0 fires email; wait job is enqueued; second email fires after wait
 *   - Pause mid-flight cancels pending wait job
 *   - Archive cancels remaining enrollments
 *   - Delete cancels enrollments + cascade-removes rows
 *   - Re-enrollment idempotency (CR-03)
 *   - Unsubscribed-during-wait — next email is skipped
 *
 * Strategy:
 *   - Real Postgres + Redis from Docker fixtures.
 *   - The BullMQ workers run IN-PROCESS (process-event, process-step,
 *     send-email, all from the worker package). The api Hono app runs in
 *     parallel via app.request().
 *   - Resend is intercepted at fetch level (no real network).
 *   - Wait delays are kept short (1–2 seconds) so the test can observe the
 *     delayed job firing without a fake clock. We DO NOT use setTimeout
 *     to model the engine's wait — the engine uses BullMQ delay and we
 *     wait for it via polling-with-timeout (CN-01-safe at test level).
 *
 * Plan SSOT: 03-plan.md lines 431-446.
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

// Parsed redis connection used by all in-process workers/queues.
function redisConn() {
  const parsed = new URL(TEST_REDIS_URL);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
  };
}

// Track jobs we enqueue so afterAll can drain them.
let stepQueue: Queue | null = null;
let eventsQueue: Queue | null = null;
let sendEmailQueue: Queue | null = null;

beforeAll(async () => {
  await waitForDb();
  await runMigrations();
  await flushRedis();

  // Lazy-import worker creators AFTER env is set in _fixtures.
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

  // Producers (used by tests + by the api process internally).
  stepQueue = new Queue("step-execution", { connection: redisConn() });
  eventsQueue = new Queue("events", { connection: redisConn() });
  sendEmailQueue = new Queue("send-email", { connection: redisConn() });

  const mod = await import("../index.js");
  app = mod.app;

  // Set default Resend success scenario; individual tests can override.
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
  setResendScenario(RESEND_SEND_OK);
});

// Helper — count rows for a workspace.
async function countSends(workspaceId: string): Promise<number> {
  const db = getRawDb();
  const [{ c }] = await db<Array<{ c: string }>>`
    SELECT COUNT(*)::text c FROM email_sends WHERE workspace_id = ${workspaceId}
  `;
  return Number(c);
}

async function getEnrollment(enrollmentId: string) {
  const db = getRawDb();
  const [row] = await db`
    SELECT * FROM campaign_enrollments WHERE id = ${enrollmentId}
  `;
  return row as any;
}

async function getEnrollments(campaignId: string) {
  const db = getRawDb();
  return await db`
    SELECT id, contact_id, status, current_step_id, completed_at FROM campaign_enrollments
    WHERE campaign_id = ${campaignId}
    ORDER BY started_at
  ` as any[];
}

// Insert an event row directly + enqueue process-event (matches what
// /api/ingest/capture would do). We bypass the HTTP layer here because
// the test's purpose is the engine, not the ingest contract (T13/T14 cover that).
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

// ─────────────────────────────────────────────────────────────────────────────

describe("Campaign engine — single email step", () => {
  it("event → enroll → email send → enrollment completed", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    const tplId = await createTemplate(workspaceId, "<p>Hello!</p>");
    const { campaignId } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "signup" },
      steps: [
        { stepType: "email", config: { templateId: tplId, subject: "Welcome!" } },
      ],
    });

    const contactId = await createContact(workspaceId, "alice@test.com");
    await ingestEventForContact(workspaceId, contactId, "alice@test.com", "signup");

    // Wait for enrollment + email_sends row + completion (no wait step).
    await waitFor(async () => (await countSends(workspaceId)) === 1, {
      description: "1 email_sends row created",
    });
    await waitFor(
      async () => {
        const enrolls = await getEnrollments(campaignId);
        return enrolls.length === 1 && enrolls[0].status === "completed";
      },
      { description: "enrollment marked completed" },
    );

    const db = getRawDb();
    const [send] = await db<
      Array<{ status: string; campaign_id: string }>
    >`SELECT status, campaign_id FROM email_sends WHERE workspace_id = ${workspaceId}`;
    expect(send.status).toBe("sent");
    expect(send.campaign_id).toBe(campaignId);
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Campaign engine — email + wait + email", () => {
  it("3-step campaign for 5 contacts: email → wait 1s → email — both sends complete", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    const tpl1 = await createTemplate(workspaceId, "<p>Step 1</p>", "step1");
    const tpl2 = await createTemplate(workspaceId, "<p>Step 2</p>", "step2");

    // Wait config: hours/days/weeks only; the smallest unit is "hours".
    // For tests, 1/3600 hours = 1 second. The engine multiplies and gets ~1000ms.
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "kickoff" },
      steps: [
        { stepType: "email", config: { templateId: tpl1, subject: "S1" } },
        { stepType: "wait", config: { duration: 1 / 3600, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl2, subject: "S2" } },
      ],
    });
    expect(steps).toHaveLength(3);

    // Enroll 5 contacts.
    const contactIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const cid = await createContact(workspaceId, `u${i}@test.com`);
      contactIds.push(cid);
      await ingestEventForContact(workspaceId, cid, `u${i}@test.com`, "kickoff");
    }

    // Step 0: each contact gets the first email.
    await waitFor(async () => (await countSends(workspaceId)) === 5, {
      description: "5 first-step sends recorded",
      timeoutMs: 15_000,
    });

    // Each enrollment should now point at the wait step.
    await waitFor(
      async () => {
        const enrolls = await getEnrollments(campaignId);
        const onWait = enrolls.filter((e) => e.current_step_id === steps[1].id);
        return enrolls.length === 5 && onWait.length === 5;
      },
      { description: "all 5 enrollments parked on wait step", timeoutMs: 15_000 },
    );

    // Wait for the wait step to elapse (~1s) and the second email batch.
    await waitFor(async () => (await countSends(workspaceId)) === 10, {
      description: "all 10 sends recorded (5 step-0 + 5 step-2)",
      timeoutMs: 20_000,
    });

    // All enrollments should be completed.
    await waitFor(
      async () => {
        const enrolls = await getEnrollments(campaignId);
        return (
          enrolls.length === 5 &&
          enrolls.every((e) => e.status === "completed" && e.completed_at)
        );
      },
      { description: "all 5 enrollments completed", timeoutMs: 15_000 },
    );
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Campaign engine — pause mid-flight cancels pending wait jobs", () => {
  it("PATCH status=paused removes step-execution jobs; later wait does NOT fire second email", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl1 = await createTemplate(workspaceId, "<p>S1</p>", "step1");
    const tpl2 = await createTemplate(workspaceId, "<p>S2</p>", "step2");

    // Long wait (10 hours) so we're guaranteed to pause BEFORE the wait fires.
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "longwait" },
      steps: [
        { stepType: "email", config: { templateId: tpl1, subject: "S1" } },
        { stepType: "wait", config: { duration: 10, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl2, subject: "S2" } },
      ],
    });

    const cid = await createContact(workspaceId, "alice@test.com");
    await ingestEventForContact(workspaceId, cid, "alice@test.com", "longwait");

    // Wait for first email to fire AND enrollment to land on the wait step.
    await waitFor(async () => (await countSends(workspaceId)) === 1, {
      description: "first email sent",
      timeoutMs: 10_000,
    });
    await waitFor(
      async () => {
        const enrolls = await getEnrollments(campaignId);
        return enrolls[0]?.current_step_id === steps[1].id;
      },
      { description: "enrollment parked on wait step", timeoutMs: 10_000 },
    );

    // Sanity: the delayed step-execution job exists in BullMQ.
    const enrollBefore = (await getEnrollments(campaignId))[0];
    const jobIdExpected = `step-execution:${enrollBefore.id}:${steps[1].id}`;
    const jobBefore = await stepQueue!.getJob(jobIdExpected);
    expect(jobBefore).toBeDefined();

    // Now pause the campaign — workspaceId is required by the workspace guard.
    // Since we don't have session auth in this test, hit the API key path.
    const res = await app.request(`/api/v1/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "paused" }),
    });
    expect(res.status).toBe(200);

    // Verify: campaign is paused, enrollment is paused, no further emails.
    const db = getRawDb();
    const [campaignRow] = await db<
      Array<{ status: string }>
    >`SELECT status FROM campaigns WHERE id = ${campaignId}`;
    expect(campaignRow.status).toBe("paused");

    const enrollAfter = (await getEnrollments(campaignId))[0];
    expect(enrollAfter.status).toBe("paused");

    // The step-execution job MUST be gone.
    const jobAfter = await stepQueue!.getJob(jobIdExpected);
    expect(jobAfter).toBeUndefined();

    // Resume is a known no-op (per execution log Group B note).
    // Flipping back to active does NOT re-enqueue the wait job — the
    // enrollment stays in "paused" state. We assert that no second email
    // was sent during this whole flow.
    expect(await countSends(workspaceId)).toBe(1);
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Campaign engine — archive cancels enrollments", () => {
  it("PATCH status=archived marks active enrollments as cancelled with completed_at", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl1 = await createTemplate(workspaceId, "<p>S1</p>", "s1");
    const tpl2 = await createTemplate(workspaceId, "<p>S2</p>", "s2");

    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "kickoff" },
      steps: [
        { stepType: "email", config: { templateId: tpl1, subject: "S1" } },
        { stepType: "wait", config: { duration: 10, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl2, subject: "S2" } },
      ],
    });

    const cid = await createContact(workspaceId, "victim@test.com");
    await ingestEventForContact(workspaceId, cid, "victim@test.com", "kickoff");
    await waitFor(
      async () => {
        const e = (await getEnrollments(campaignId))[0];
        return e?.current_step_id === steps[1].id;
      },
      { description: "parked on wait step", timeoutMs: 10_000 },
    );

    const res = await app.request(`/api/v1/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "archived" }),
    });
    expect(res.status).toBe(200);

    const enroll = (await getEnrollments(campaignId))[0];
    expect(enroll.status).toBe("cancelled");
    expect(enroll.completed_at).not.toBeNull();
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Campaign engine — delete cancels and cascade-removes", () => {
  it("DELETE /campaigns/:id cancels step-execution jobs + cascade-deletes enrollments", async () => {
    const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
    const tpl1 = await createTemplate(workspaceId, "<p>S1</p>", "s1");

    // Long wait so we have something to cancel.
    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "kickoff" },
      // Status must NOT be "active" for delete (route refuses delete on active).
      // We pause it first by creating directly with paused status — but the
      // engine still operates if we set status='paused' before any enrolls?
      // Actually: process-event filters by `eq(campaigns.status, "active")`,
      // so a paused campaign won't enroll new contacts. We need to enroll
      // FIRST while active, then PAUSE, then DELETE.
      status: "active",
      steps: [
        { stepType: "email", config: { templateId: tpl1, subject: "S1" } },
        { stepType: "wait", config: { duration: 10, unit: "hours" } },
      ],
    });

    const cid = await createContact(workspaceId, "alice@test.com");
    await ingestEventForContact(workspaceId, cid, "alice@test.com", "kickoff");
    await waitFor(
      async () => (await getEnrollments(campaignId))[0]?.current_step_id === steps[1].id,
      { description: "parked on wait step", timeoutMs: 10_000 },
    );

    const enrollBefore = (await getEnrollments(campaignId))[0];
    const jobIdExpected = `step-execution:${enrollBefore.id}:${steps[1].id}`;
    const jobBefore = await stepQueue!.getJob(jobIdExpected);
    expect(jobBefore).toBeDefined();

    // Pause first (DELETE on active is forbidden by route).
    await app.request(`/api/v1/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "paused" }),
    });

    const res = await app.request(`/api/v1/campaigns/${campaignId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(200);

    // Campaign + enrollments must be gone (FK cascade).
    const db = getRawDb();
    const [{ c: campaignCount }] = await db<Array<{ c: string }>>`
      SELECT COUNT(*)::text c FROM campaigns WHERE id = ${campaignId}
    `;
    const [{ c: enrollCount }] = await db<Array<{ c: string }>>`
      SELECT COUNT(*)::text c FROM campaign_enrollments WHERE campaign_id = ${campaignId}
    `;
    expect(Number(campaignCount)).toBe(0);
    expect(Number(enrollCount)).toBe(0);

    // The step-execution job must also be removed (already cleared by
    // pause; but DELETE-path also calls cancelCampaignJobs as a safety net).
    const jobAfter = await stepQueue!.getJob(jobIdExpected);
    expect(jobAfter).toBeUndefined();
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Campaign engine — re-enrollment idempotency (CR-03)", () => {
  it("re-firing the same event for the same contact does NOT restart steps", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    const tpl1 = await createTemplate(workspaceId, "<p>S1</p>", "s1");
    const tpl2 = await createTemplate(workspaceId, "<p>S2</p>", "s2");

    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "kickoff" },
      steps: [
        { stepType: "email", config: { templateId: tpl1, subject: "S1" } },
        { stepType: "wait", config: { duration: 10, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl2, subject: "S2" } },
      ],
    });

    const cid = await createContact(workspaceId, "alice@test.com");

    // First event — enrolls.
    await ingestEventForContact(workspaceId, cid, "alice@test.com", "kickoff");
    await waitFor(
      async () => (await getEnrollments(campaignId))[0]?.current_step_id === steps[1].id,
      { description: "parked on wait", timeoutMs: 10_000 },
    );
    expect(await countSends(workspaceId)).toBe(1);
    const enrollAfter1 = (await getEnrollments(campaignId))[0];

    // Same contact, same event — must NOT restart.
    await ingestEventForContact(workspaceId, cid, "alice@test.com", "kickoff");

    // Brief settling time for the second event to be processed (it is a
    // no-op per process-event idempotency: existing && status==="active"
    // → skip). We poll for "no second email" by ensuring the count stays 1
    // across a settling window.
    await Bun.sleep(500);

    const enrolls = await getEnrollments(campaignId);
    expect(enrolls).toHaveLength(1);
    const enrollAfter2 = enrolls[0];
    // Same enrollment id — wasn't replaced.
    expect(enrollAfter2.id).toBe(enrollAfter1.id);
    // Still on wait step.
    expect(enrollAfter2.current_step_id).toBe(steps[1].id);
    // Still only one send.
    expect(await countSends(workspaceId)).toBe(1);
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Campaign engine — unsubscribed contact during wait", () => {
  it("contact unsubscribes between step 0 and step 2 → step 2 is skipped, enrollment completes", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    const tpl1 = await createTemplate(workspaceId, "<p>S1</p>", "s1");
    const tpl2 = await createTemplate(workspaceId, "<p>S2</p>", "s2");

    const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
      triggerType: "event",
      triggerConfig: { eventName: "kickoff" },
      steps: [
        { stepType: "email", config: { templateId: tpl1, subject: "S1" } },
        // Short wait so we can observe the next step quickly.
        { stepType: "wait", config: { duration: 1 / 3600, unit: "hours" } },
        { stepType: "email", config: { templateId: tpl2, subject: "S2" } },
      ],
    });

    const cid = await createContact(workspaceId, "leaver@test.com");
    await ingestEventForContact(workspaceId, cid, "leaver@test.com", "kickoff");

    // Wait for first email + wait step parking.
    await waitFor(async () => (await countSends(workspaceId)) === 1, {
      description: "first email sent",
      timeoutMs: 10_000,
    });
    await waitFor(
      async () => (await getEnrollments(campaignId))[0]?.current_step_id === steps[1].id,
      { description: "parked on wait", timeoutMs: 10_000 },
    );

    // Mark the contact unsubscribed before the wait fires.
    const db = getRawDb();
    await db`
      UPDATE contacts SET unsubscribed = true, unsubscribed_at = now()
      WHERE id = ${cid}
    `;

    // Wait for the delayed job to fire and the enrollment to be marked
    // completed WITHOUT a second email being sent.
    await waitFor(
      async () => {
        const enroll = (await getEnrollments(campaignId))[0];
        return enroll?.status === "completed";
      },
      { description: "enrollment completed (skipped step 2)", timeoutMs: 20_000 },
    );

    expect(await countSends(workspaceId)).toBe(1);
  }, 40_000);
});
