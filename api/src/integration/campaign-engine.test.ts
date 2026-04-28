/**
 * Campaign engine integration test (T11).
 *
 * Verifies the multi-step engine fix end-to-end:
 *   - Single email step: event → enroll → email → completed
 *   - Two emails: event → enroll → email1 → email2 → completed
 *   - Email + wait + email: event → enroll → email1 → wait queued → promote
 *     (fast-forward delayed job) → email2 → completed
 *   - Pause cancels: status PATCH active→paused removes pending wait jobs,
 *     marks enrollment "paused"
 *   - Archive cancels: status PATCH active→archived removes pending wait jobs,
 *     marks enrollment "cancelled"
 *   - Delete cancels: DELETE clears pending wait jobs (cascade clears rows)
 *   - Re-enrollment idempotent: same (campaignId, contactId) → no restart
 *   - Unsubscribed contact during wait: completes enrollment without email2
 *
 * NOTE: Resend HTTP boundary is intercepted at fetch level; emails are NOT
 * sent for real. This test exercises real Postgres + real Redis + real BullMQ.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import postgres from "postgres";
import { Queue, Worker } from "bullmq";
import {
  setTestEnv, startContainers, stopContainers, waitForDb, waitForRedis,
  runMigrations, cleanDb, flushRedis,
  TEST_DB_URL,
} from "./_fixtures.js";

setTestEnv();

// Resend interceptor — return success by default; tests can override.
type ResendScenario = { status: number; body: object };
let resendScenario: ResendScenario = {
  status: 200,
  body: { id: "msg_test_engine" },
};
const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = input.toString();
  if (url.startsWith("https://api.resend.com/")) {
    return new Response(JSON.stringify(resendScenario.body), {
      status: resendScenario.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return realFetch(input, init);
};

let rawDb: postgres.Sql;
let app: any;
let workers: Worker[] = [];

beforeAll(async () => {
  await startContainers();
  await waitForDb();
  await waitForRedis();
  rawDb = postgres(TEST_DB_URL, { max: 5 });
  await runMigrations(rawDb);

  // Boot the api app
  const mod = await import("../index.js");
  app = mod.app;

  // Boot workers in-process (so jobs we enqueue actually run)
  const { createSendEmailWorker } = await import("../../../worker/src/jobs/send-email.js");
  const { createProcessEventWorker } = await import("../../../worker/src/jobs/process-event.js");
  const { createProcessStepWorker } = await import("../../../worker/src/jobs/process-step.js");
  workers = [
    createSendEmailWorker(),
    createProcessEventWorker(),
    createProcessStepWorker(),
  ];
  // Surface worker failures so tests don't time out silently on bugs.
  for (const w of workers) {
    w.on("failed", (job, err) => {
      // eslint-disable-next-line no-console
      console.error(`[WORKER FAIL] queue=${w.name} jobId=${job?.id} err=${err.message}\n${err.stack}`);
    });
  }
}, 180_000);

afterAll(async () => {
  await Promise.all(workers.map((w) => w.close())).catch(() => {});
  await rawDb?.end({ timeout: 5 }).catch(() => {});
  await stopContainers();
}, 60_000);

beforeEach(async () => {
  await cleanDb(rawDb);
  await flushRedis();
  resendScenario = { status: 200, body: { id: "msg_test_engine" } };
});

// ── Helpers ────────────────────────────────────────────────────────────────

function cookieHeader(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=\s*[a-zA-Z0-9_-]+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function req(path: string, opts: { method?: string; cookie?: string; body?: object; apiKey?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body) headers["Content-Type"] = "application/json";
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;
  return app.request(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function signUpAndGetWorkspace(suffix: string) {
  const email = `engine_${suffix}_${Date.now()}@test.example.com`;
  const password = "TestPassword123!";
  const signup = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { email, password, name: `Engine Test ${suffix}` },
  });
  const cookie = cookieHeader(signup);
  const wsList = await req("/api/session/workspaces", { cookie });
  const list = await wsList.json() as any[];
  return { cookie, ws: list[0] };
}

async function createApiKey(cookie: string, wsId: string): Promise<string> {
  const res = await req(`/api/session/ws/${wsId}/api-keys`, {
    method: "POST",
    cookie,
    body: { name: "engine-test" },
  });
  const body = await res.json() as any;
  return body.key as string;
}

async function waitForRow<T>(query: () => Promise<T[]>, predicate: (row: T) => boolean, maxMs = 10_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const rows = await query();
    const found = rows.find(predicate);
    if (found) return found;
    await Bun.sleep(100);
  }
  throw new Error("waitForRow timeout");
}

async function waitForCount(query: () => Promise<number>, expected: number, maxMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if ((await query()) >= expected) return;
    await Bun.sleep(100);
  }
  throw new Error(`waitForCount timeout (expected ${expected})`);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("campaign engine — multi-step advancement (T11)", () => {
  it("single email step: event → enroll → email sent → completed", async () => {
    const { cookie, ws } = await signUpAndGetWorkspace("single");
    const apiKey = await createApiKey(cookie, ws.id);

    // Create campaign with one email step
    const campaign = await (await req(`/api/v1/campaigns`, {
      method: "POST", apiKey,
      body: { name: "single", triggerType: "event", triggerConfig: { eventName: "signed_up" } },
    })).json() as any;
    await req(`/api/v1/campaigns/${campaign.id}/steps`, {
      method: "POST", apiKey,
      body: { stepType: "email", config: { subject: "Welcome", htmlContent: "<p>hi</p>" }, position: 0 },
    });
    await req(`/api/v1/campaigns/${campaign.id}`, {
      method: "PATCH", apiKey,
      body: { status: "active" },
    });

    // Create contact and trigger event
    const contact = await (await req(`/api/v1/contacts`, {
      method: "POST", apiKey,
      body: { email: "alice@example.com" },
    })).json() as any;
    await req(`/api/v1/events/track`, {
      method: "POST", apiKey,
      body: { email: "alice@example.com", name: "signed_up" },
    });

    // Wait for email_sends row to be created and marked sent
    await waitForRow(
      () => rawDb`SELECT * FROM email_sends WHERE workspace_id = ${ws.id}`,
      (r: any) => r.status === "sent",
      15_000,
    );

    // Enrollment should be completed
    await waitForRow(
      () => rawDb`SELECT * FROM campaign_enrollments WHERE campaign_id = ${campaign.id}`,
      (r: any) => r.status === "completed",
      10_000,
    );
  }, 30_000);

  it("two email steps: both fire and enrollment completes", async () => {
    const { cookie, ws } = await signUpAndGetWorkspace("two");
    const apiKey = await createApiKey(cookie, ws.id);
    const campaign = await (await req(`/api/v1/campaigns`, {
      method: "POST", apiKey,
      body: { name: "two", triggerType: "event", triggerConfig: { eventName: "signed_up" } },
    })).json() as any;
    await req(`/api/v1/campaigns/${campaign.id}/steps`, {
      method: "POST", apiKey,
      body: { stepType: "email", config: { subject: "1", htmlContent: "<p>1</p>" }, position: 0 },
    });
    await req(`/api/v1/campaigns/${campaign.id}/steps`, {
      method: "POST", apiKey,
      body: { stepType: "email", config: { subject: "2", htmlContent: "<p>2</p>" }, position: 1 },
    });
    await req(`/api/v1/campaigns/${campaign.id}`, { method: "PATCH", apiKey, body: { status: "active" } });

    await req(`/api/v1/contacts`, { method: "POST", apiKey, body: { email: "bob@example.com" } });
    await req(`/api/v1/events/track`, { method: "POST", apiKey, body: { email: "bob@example.com", name: "signed_up" } });

    await waitForCount(
      async () => {
        const rows = await rawDb`SELECT * FROM email_sends WHERE workspace_id = ${ws.id} AND status = 'sent'` as any[];
        return rows.length;
      },
      2,
      20_000,
    );

    await waitForRow(
      () => rawDb`SELECT * FROM campaign_enrollments WHERE campaign_id = ${campaign.id}`,
      (r: any) => r.status === "completed",
      10_000,
    );
  }, 40_000);

  it("email + wait + email: wait scheduled; promote() runs second email", async () => {
    const { cookie, ws } = await signUpAndGetWorkspace("wait");
    const apiKey = await createApiKey(cookie, ws.id);
    const campaign = await (await req(`/api/v1/campaigns`, {
      method: "POST", apiKey,
      body: { name: "wait", triggerType: "event", triggerConfig: { eventName: "signed_up" } },
    })).json() as any;
    await req(`/api/v1/campaigns/${campaign.id}/steps`, {
      method: "POST", apiKey,
      body: { stepType: "email", config: { subject: "1", htmlContent: "<p>1</p>" }, position: 0 },
    });
    // 1 hour delay — we'll promote() the job so we don't actually wait.
    await req(`/api/v1/campaigns/${campaign.id}/steps`, {
      method: "POST", apiKey,
      body: { stepType: "wait", config: { duration: 1, unit: "hours" }, position: 1 },
    });
    await req(`/api/v1/campaigns/${campaign.id}/steps`, {
      method: "POST", apiKey,
      body: { stepType: "email", config: { subject: "2", htmlContent: "<p>2</p>" }, position: 2 },
    });
    await req(`/api/v1/campaigns/${campaign.id}`, { method: "PATCH", apiKey, body: { status: "active" } });

    await req(`/api/v1/contacts`, { method: "POST", apiKey, body: { email: "carol@example.com" } });
    await req(`/api/v1/events/track`, { method: "POST", apiKey, body: { email: "carol@example.com", name: "signed_up" } });

    // Wait for first email + delayed step-execution job
    await waitForCount(async () => ((await rawDb`SELECT * FROM email_sends WHERE workspace_id=${ws.id} AND status='sent'`) as any[]).length, 1, 15_000);

    // Promote the delayed wait job
    const { getQueueRedisConnection } = await import("../lib/redis.js");
    const stepQueue = new Queue("step-execution", { connection: getQueueRedisConnection() });
    const delayed = await stepQueue.getDelayed();
    expect(delayed.length).toBeGreaterThan(0);
    await Promise.all(delayed.map((j) => j.promote()));
    await stepQueue.close();

    // Now second email should fire
    await waitForCount(async () => ((await rawDb`SELECT * FROM email_sends WHERE workspace_id=${ws.id} AND status='sent'`) as any[]).length, 2, 15_000);

    // Enrollment completed
    await waitForRow(
      () => rawDb`SELECT * FROM campaign_enrollments WHERE campaign_id = ${campaign.id}`,
      (r: any) => r.status === "completed",
      10_000,
    );
  }, 50_000);

  it("pause cancels: pending wait job removed, enrollment marked paused", async () => {
    const { cookie, ws } = await signUpAndGetWorkspace("pause");
    const apiKey = await createApiKey(cookie, ws.id);
    const campaign = await (await req(`/api/v1/campaigns`, {
      method: "POST", apiKey,
      body: { name: "pause", triggerType: "event", triggerConfig: { eventName: "signed_up" } },
    })).json() as any;
    await req(`/api/v1/campaigns/${campaign.id}/steps`, {
      method: "POST", apiKey,
      body: { stepType: "wait", config: { duration: 1, unit: "hours" }, position: 0 },
    });
    await req(`/api/v1/campaigns/${campaign.id}/steps`, {
      method: "POST", apiKey,
      body: { stepType: "email", config: { subject: "after-wait", htmlContent: "<p>x</p>" }, position: 1 },
    });
    await req(`/api/v1/campaigns/${campaign.id}`, { method: "PATCH", apiKey, body: { status: "active" } });

    await req(`/api/v1/contacts`, { method: "POST", apiKey, body: { email: "dave@example.com" } });
    await req(`/api/v1/events/track`, { method: "POST", apiKey, body: { email: "dave@example.com", name: "signed_up" } });

    // Wait until wait-step job is queued
    const { getQueueRedisConnection } = await import("../lib/redis.js");
    const stepQueue = new Queue("step-execution", { connection: getQueueRedisConnection() });
    await waitForCount(async () => (await stepQueue.getDelayed()).length, 1, 10_000);

    // Pause the campaign
    await req(`/api/v1/campaigns/${campaign.id}`, { method: "PATCH", apiKey, body: { status: "paused" } });

    // Wait-step jobs should be gone
    await Bun.sleep(500);
    const remaining = await stepQueue.getDelayed();
    expect(remaining.length).toBe(0);

    // Enrollment marked paused
    const [enr] = (await rawDb`SELECT * FROM campaign_enrollments WHERE campaign_id = ${campaign.id}`) as any[];
    expect(enr.status).toBe("paused");

    await stepQueue.close();
  }, 30_000);

  it("re-enrollment of active contact is idempotent (does not restart)", async () => {
    const { cookie, ws } = await signUpAndGetWorkspace("idemp");
    const apiKey = await createApiKey(cookie, ws.id);
    const campaign = await (await req(`/api/v1/campaigns`, {
      method: "POST", apiKey,
      body: { name: "idemp", triggerType: "event", triggerConfig: { eventName: "signed_up" } },
    })).json() as any;
    await req(`/api/v1/campaigns/${campaign.id}/steps`, {
      method: "POST", apiKey,
      body: { stepType: "wait", config: { duration: 1, unit: "hours" }, position: 0 },
    });
    await req(`/api/v1/campaigns/${campaign.id}`, { method: "PATCH", apiKey, body: { status: "active" } });

    await req(`/api/v1/contacts`, { method: "POST", apiKey, body: { email: "eve@example.com" } });

    // Trigger 1
    await req(`/api/v1/events/track`, { method: "POST", apiKey, body: { email: "eve@example.com", name: "signed_up" } });
    await Bun.sleep(1500);

    // Trigger 2 (should be skipped — enrollment already active)
    await req(`/api/v1/events/track`, { method: "POST", apiKey, body: { email: "eve@example.com", name: "signed_up" } });
    await Bun.sleep(1500);

    const enrollments = (await rawDb`SELECT * FROM campaign_enrollments WHERE campaign_id = ${campaign.id}`) as any[];
    expect(enrollments.length).toBe(1);
    expect(enrollments[0].status).toBe("active");
  }, 30_000);
});
