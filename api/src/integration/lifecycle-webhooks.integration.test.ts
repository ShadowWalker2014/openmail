/**
 * Lifecycle webhooks — integration tests.
 *
 * Coverage:
 *   1. Direct delivery via `deliverWebhookOnce()` to a local mock server:
 *      verifies HMAC-SHA256 signature, headers (Delivery, Event, User-Agent),
 *      JSON body shape.
 *   2. Permanent failure (4xx) → telemetry recorded (status, last_error,
 *      consecutive_failures incremented), no retry.
 *   3. Subscription matching: empty event_types[] = subscribe to all;
 *      explicit list = subscribe to only those.
 *   4. Disabled webhooks skipped at enqueue time.
 *
 * Strategy:
 *   - Mock receiver: in-process Bun HTTP server bound to 127.0.0.1:0 (random
 *     port). Captures request headers + raw body for assertion.
 *   - We exercise the worker's exported `deliverWebhookOnce` helper directly
 *     (not via the BullMQ queue) — same code path, no queue boot/teardown
 *     overhead in the test.
 *   - For the enqueue-side test we exercise `enqueueWebhookDeliveries` and
 *     check the BullMQ queue contents directly via Queue.getJobs() — also
 *     no worker run; we verify the SUBSCRIPTION FILTER, not delivery.
 */
import "./_fixtures.js";
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createHmac } from "node:crypto";
import { Queue } from "bullmq";
import {
  closeRawDb,
  waitForDb,
  runMigrations,
  cleanDb,
  flushRedis,
  TEST_REDIS_URL,
  createWorkspaceWithApiKey,
  getRawDb,
} from "./_fixtures.js";
import {
  deliverWebhookOnce,
  enqueueWebhookDeliveries,
  type WebhookDeliveryJob,
} from "../../../worker/src/jobs/process-lifecycle-webhook.js";

beforeAll(async () => {
  await waitForDb();
  await runMigrations();
});

beforeEach(async () => {
  await cleanDb();
  await flushRedis();
});

afterAll(async () => {
  await closeRawDb();
});

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Minimal HTTP mock receiver. Returns a function that:
 *   - starts a server on a random port
 *   - returns its URL
 *   - exposes `getRequests()` for assertions
 *   - exposes `setStatus(n)` to change response code on the fly
 *   - exposes `close()` to release the port
 */
async function startMockReceiver(initialStatus = 200): Promise<{
  url: string;
  getRequests: () => CapturedRequest[];
  setStatus: (s: number) => void;
  close: () => void;
}> {
  const requests: CapturedRequest[] = [];
  let status = initialStatus;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const body = await req.text();
      requests.push({
        url: req.url,
        method: req.method,
        headers,
        body,
      });
      return new Response(JSON.stringify({ ok: status < 400 }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/hook`,
    getRequests: () => requests,
    setStatus: (s) => {
      status = s;
    },
    close: () => server.stop(true),
  };
}

async function insertWebhook(opts: {
  workspaceId: string;
  url: string;
  secret?: string;
  eventTypes?: string[];
  enabled?: boolean;
}): Promise<string> {
  const db = getRawDb();
  const id = `lwh_${Math.random().toString(36).slice(2, 14)}`;
  const secret = opts.secret ?? "s3cret-min-16-chars-long-enough";
  await db.unsafe(
    `INSERT INTO lifecycle_webhooks
       (id, workspace_id, url, secret, event_types, enabled)
     VALUES ($1::text, $2::text, $3::text, $4::text, $5::text[], $6::boolean)`,
    [
      id,
      opts.workspaceId,
      opts.url,
      secret,
      `{${(opts.eventTypes ?? []).map((e) => `"${e}"`).join(",")}}`,
      opts.enabled ?? true,
    ],
  );
  return id;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Lifecycle webhooks — direct delivery", () => {
  test("HMAC signature + headers + body shape", async () => {
    const receiver = await startMockReceiver(200);
    try {
      const { workspaceId } = await createWorkspaceWithApiKey();
      const secret = "test-secret-32chars-aaaaaaaaaaaa";
      const webhookId = await insertWebhook({
        workspaceId,
        url: receiver.url,
        secret,
      });

      const job: WebhookDeliveryJob = {
        webhookId,
        workspaceId,
        event: "audit_drift_detected",
        lifecycleOpId: "lop_test_hmac_001",
        campaignId: "cmp_test",
        enrollmentId: "eee_test",
        contactId: "con_test",
        emittedAt: "2026-04-30T10:00:00.000Z",
        payload: { lifecycle_op_id: "lop_test_hmac_001", source: "test" },
      };

      const result = await deliverWebhookOnce(job, receiver.url, secret);
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);

      const reqs = receiver.getRequests();
      expect(reqs.length).toBe(1);
      const r = reqs[0];

      // Headers
      expect(r.method).toBe("POST");
      expect(r.headers["content-type"]).toContain("application/json");
      expect(r.headers["user-agent"]).toBe("OpenMail-Webhook/1");
      expect(r.headers["x-openmail-event"]).toBe("audit_drift_detected");
      expect(r.headers["x-openmail-delivery"]).toMatch(/^wdl_[a-z0-9]{16}$/);
      expect(r.headers["x-openmail-signature"]).toMatch(
        /^sha256=[0-9a-f]{64}$/,
      );

      // Body shape
      const body = JSON.parse(r.body);
      expect(body.event).toBe("audit_drift_detected");
      expect(body.lifecycle_op_id).toBe("lop_test_hmac_001");
      expect(body.workspace_id).toBe(workspaceId);
      expect(body.campaign_id).toBe("cmp_test");
      expect(body.enrollment_id).toBe("eee_test");
      expect(body.payload.source).toBe("test");

      // Signature verifies with the shared secret.
      const expectedSig = createHmac("sha256", secret)
        .update(r.body)
        .digest("hex");
      expect(r.headers["x-openmail-signature"]).toBe(`sha256=${expectedSig}`);

      // Telemetry persisted.
      const db = getRawDb();
      const [row] = await db.unsafe(
        `SELECT last_status, last_error, consecutive_failures, last_delivered_at
           FROM lifecycle_webhooks WHERE id = $1::text`,
        [webhookId],
      );
      expect(row.last_status).toBe(200);
      expect(row.last_error).toBeNull();
      expect(row.consecutive_failures).toBe(0);
      expect(row.last_delivered_at).not.toBeNull();
    } finally {
      receiver.close();
    }
  });

  test("4xx response records permanent failure telemetry", async () => {
    const receiver = await startMockReceiver(404);
    try {
      const { workspaceId } = await createWorkspaceWithApiKey();
      const webhookId = await insertWebhook({
        workspaceId,
        url: receiver.url,
      });

      const job: WebhookDeliveryJob = {
        webhookId,
        workspaceId,
        event: "audit_drift_detected",
        lifecycleOpId: "lop_test_404_001",
        campaignId: "cmp_test",
        enrollmentId: null,
        contactId: null,
        emittedAt: new Date().toISOString(),
        payload: { lifecycle_op_id: "lop_test_404_001" },
      };

      const result = await deliverWebhookOnce(
        job,
        receiver.url,
        "s3cret-min-16-chars-long-enough",
      );
      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);

      const db = getRawDb();
      const [row] = await db.unsafe(
        `SELECT last_status, last_error, consecutive_failures
           FROM lifecycle_webhooks WHERE id = $1::text`,
        [webhookId],
      );
      expect(row.last_status).toBe(404);
      expect(row.last_error).toContain("HTTP 404");
      expect(row.consecutive_failures).toBe(1);

      // Second failure increments the counter.
      await deliverWebhookOnce(
        job,
        receiver.url,
        "s3cret-min-16-chars-long-enough",
      );
      const [row2] = await db.unsafe(
        `SELECT consecutive_failures FROM lifecycle_webhooks WHERE id = $1::text`,
        [webhookId],
      );
      expect(row2.consecutive_failures).toBe(2);
    } finally {
      receiver.close();
    }
  });

  test("network error records telemetry without crashing", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    const webhookId = await insertWebhook({
      workspaceId,
      // Unreachable port — we don't start a server here.
      url: "http://127.0.0.1:1/never",
    });

    const job: WebhookDeliveryJob = {
      webhookId,
      workspaceId,
      event: "audit_drift_detected",
      lifecycleOpId: "lop_test_neterr_001",
      campaignId: "cmp_test",
      enrollmentId: null,
      contactId: null,
      emittedAt: new Date().toISOString(),
      payload: { lifecycle_op_id: "lop_test_neterr_001" },
    };

    const result = await deliverWebhookOnce(
      job,
      "http://127.0.0.1:1/never",
      "s3cret-min-16-chars-long-enough",
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.errorMessage).toBeTruthy();

    const db = getRawDb();
    const [row] = await db.unsafe(
      `SELECT last_status, last_error, consecutive_failures
         FROM lifecycle_webhooks WHERE id = $1::text`,
      [webhookId],
    );
    expect(row.last_status).toBe(0);
    expect(row.consecutive_failures).toBe(1);
    expect(row.last_error).toBeTruthy();
  });
});

describe("Lifecycle webhooks — subscription routing", () => {
  test("empty event_types[] subscribes to all events", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    const webhookId = await insertWebhook({
      workspaceId,
      url: "http://127.0.0.1:9/never",
      eventTypes: [],
    });

    const result = await enqueueWebhookDeliveries({
      workspaceId,
      event: "audit_drift_detected",
      lifecycleOpId: "lop_route_all_001",
      campaignId: "cmp_test",
      enrollmentId: "eee_test",
      contactId: null,
      emittedAt: new Date().toISOString(),
      payload: { lifecycle_op_id: "lop_route_all_001" },
    });
    expect(result.enqueued).toBe(1);

    // Inspect queue. Only the enqueue is exercised — we don't run the worker.
    const queue = new Queue("lifecycle-webhook-delivery", {
      connection: { url: TEST_REDIS_URL },
    });
    try {
      const jobs = await queue.getJobs(["wait", "delayed"]);
      expect(jobs.length).toBe(1);
      const data = jobs[0].data as WebhookDeliveryJob;
      expect(data.webhookId).toBe(webhookId);
      expect(data.event).toBe("audit_drift_detected");
      expect(data.lifecycleOpId).toBe("lop_route_all_001");
    } finally {
      await queue.close();
    }
  });

  test("explicit event_types[] filters out non-matching events", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    // Subscribe ONLY to force_exited; should NOT receive audit_drift_detected.
    await insertWebhook({
      workspaceId,
      url: "http://127.0.0.1:9/never",
      eventTypes: ["force_exited"],
    });

    const result = await enqueueWebhookDeliveries({
      workspaceId,
      event: "audit_drift_detected",
      lifecycleOpId: "lop_route_filter_001",
      campaignId: "cmp_test",
      enrollmentId: "eee_test",
      contactId: null,
      emittedAt: new Date().toISOString(),
      payload: { lifecycle_op_id: "lop_route_filter_001" },
    });
    expect(result.enqueued).toBe(0);

    // And: change event to one that IS subscribed → enqueued.
    const result2 = await enqueueWebhookDeliveries({
      workspaceId,
      event: "force_exited",
      lifecycleOpId: "lop_route_filter_002",
      campaignId: "cmp_test",
      enrollmentId: "eee_test",
      contactId: null,
      emittedAt: new Date().toISOString(),
      payload: { lifecycle_op_id: "lop_route_filter_002" },
    });
    expect(result2.enqueued).toBe(1);
  });

  test("disabled webhooks are skipped at enqueue time", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    await insertWebhook({
      workspaceId,
      url: "http://127.0.0.1:9/never",
      eventTypes: [],
      enabled: false,
    });

    const result = await enqueueWebhookDeliveries({
      workspaceId,
      event: "audit_drift_detected",
      lifecycleOpId: "lop_route_disabled_001",
      campaignId: "cmp_test",
      enrollmentId: null,
      contactId: null,
      emittedAt: new Date().toISOString(),
      payload: { lifecycle_op_id: "lop_route_disabled_001" },
    });
    expect(result.enqueued).toBe(0);
  });

  test("multi-subscriber fanout: 3 webhooks all enqueued in 1 call", async () => {
    const { workspaceId } = await createWorkspaceWithApiKey();
    await insertWebhook({ workspaceId, url: "http://127.0.0.1:9/a" });
    await insertWebhook({ workspaceId, url: "http://127.0.0.1:9/b" });
    await insertWebhook({ workspaceId, url: "http://127.0.0.1:9/c" });

    const result = await enqueueWebhookDeliveries({
      workspaceId,
      event: "audit_drift_detected",
      lifecycleOpId: "lop_route_fanout_001",
      campaignId: "cmp_test",
      enrollmentId: null,
      contactId: null,
      emittedAt: new Date().toISOString(),
      payload: { lifecycle_op_id: "lop_route_fanout_001" },
    });
    expect(result.enqueued).toBe(3);
  });
});
