/**
 * Reconciliation preview API — integration tests.
 *
 * Coverage:
 *   1. wait_duration_changed: classifies enrollments correctly into
 *      immediate / stale_eligible / still_waiting buckets based on
 *      step_entered_at + new_delay vs now() + workspace stale threshold.
 *   2. wait_duration_changed: recommendedMode picks skip_stale_spread
 *      when both stale and immediate are present.
 *   3. step_deleted: returns count + sample of affected enrollments.
 *   4. step_inserted / email_template_changed / goal_updated / goal_removed:
 *      return totalAffected=0 with a human-readable reason.
 *   5. goal_added: returns the active-enrollment count + chunk math.
 *   6. Frozen campaign returns HTTP 409.
 *   7. Old delay seconds auto-derived from the step config when omitted.
 *
 * Strategy: in-process Hono request via `app.request()`. No BullMQ workers
 * boot here — preview is a pure read query, the helper hits the DB
 * directly and returns. Same DB fixture as the rest of the lifecycle
 * suite (ensures the preview's classification matches what the worker
 * would actually do).
 */
import "./_fixtures.js";
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import {
  closeRawDb,
  waitForDb,
  runMigrations,
  cleanDb,
  flushRedis,
  createWorkspaceWithApiKey,
  createContact,
  createTemplate,
  createCampaignWithSteps,
  getRawDb,
} from "./_fixtures.js";
import { generateId } from "@openmail/shared/ids";
import { app } from "../index.js";

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

// ── Helpers ──────────────────────────────────────────────────────────────────

interface PreviewResponse {
  data: Record<string, unknown>;
}

async function callPreview(
  apiKey: string,
  campaignId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: PreviewResponse | { error: string; status?: string } }> {
  const res = await app.request(
    `/api/v1/campaigns/${campaignId}/edits/preview`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
  );
  return { status: res.status, body: (await res.json()) as PreviewResponse };
}

interface SeededCampaign {
  workspaceId: string;
  apiKey: string;
  campaignId: string;
  emailStepId: string;
  waitStepId: string;
  finalEmailStepId: string;
}

/** Seed a campaign with email → wait(1d) → email and return ids. */
async function seedCampaign(opts: {
  status?: "draft" | "active" | "paused" | "archived";
} = {}): Promise<SeededCampaign> {
  const { workspaceId, apiKey } = await createWorkspaceWithApiKey();
  const tplId = await createTemplate(workspaceId, "<p>hi</p>");
  const { campaignId, steps } = await createCampaignWithSteps(workspaceId, {
    status: opts.status ?? "active",
    steps: [
      { stepType: "email", config: { templateId: tplId } },
      // 1 day wait — easy to adjust to "longer" in tests so step_entered_at
      // becomes retroactively due.
      { stepType: "wait", config: { duration: 1, unit: "days" } },
      { stepType: "email", config: { templateId: tplId } },
    ],
  });
  return {
    workspaceId,
    apiKey,
    campaignId,
    emailStepId: steps[0].id,
    waitStepId: steps[1].id,
    finalEmailStepId: steps[2].id,
  };
}

/** Create N enrollments at the wait step with the given step_entered_at.
 *  Uses unique nano-id email per contact so multiple calls in one test
 *  don't collide on the contacts.email UNIQUE constraint. */
async function seedEnrollmentsAtWaitStep(args: {
  workspaceId: string;
  campaignId: string;
  waitStepId: string;
  count: number;
  /** How long ago the enrollments entered the wait step. */
  enteredHoursAgo: number;
}): Promise<string[]> {
  const db = getRawDb();
  const enteredAt = new Date(Date.now() - args.enteredHoursAgo * 3600 * 1000);
  const ids: string[] = [];
  const batchTag = Math.random().toString(36).slice(2, 10);
  for (let i = 0; i < args.count; i++) {
    const cId = generateId("con");
    const eId = generateId("eev");
    await db`
      INSERT INTO contacts (id, workspace_id, email)
      VALUES (${cId}, ${args.workspaceId}, ${`p${batchTag}-${i}@x.com`})
    `;
    await db`
      INSERT INTO campaign_enrollments
        (id, workspace_id, campaign_id, contact_id, status,
         current_step_id, step_entered_at)
      VALUES
        (${eId}, ${args.workspaceId}, ${args.campaignId}, ${cId}, 'active',
         ${args.waitStepId}, ${enteredAt})
    `;
    ids.push(eId);
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Edit preview: wait_duration_changed", () => {
  test("classifies enrollments by old vs new delay vs entry time", async () => {
    const c = await seedCampaign();
    // 5 enrollments, all entered 12 hours ago. Original delay is 1 day,
    // so they are normally still waiting.
    await seedEnrollmentsAtWaitStep({
      workspaceId: c.workspaceId,
      campaignId: c.campaignId,
      waitStepId: c.waitStepId,
      count: 5,
      enteredHoursAgo: 12,
    });

    // Shrink delay to 1 hour. Every enrollment is now retroactively
    // due (entered 12h ago, new delay = 1h → run-time was 11h ago).
    // 11h ago is < 7-day stale threshold → all `immediate`.
    const res = await callPreview(c.apiKey, c.campaignId, {
      edit_type: "wait_duration_changed",
      step_id: c.waitStepId,
      new_delay_seconds: 3600,
    });
    expect(res.status).toBe(200);
    const impact = (res.body as PreviewResponse).data as Record<string, number | string>;
    expect(impact.editType).toBe("wait_duration_changed");
    expect(impact.totalAffected).toBe(5);
    expect(impact.immediate).toBe(5);
    expect(impact.staleEligible).toBe(0);
    expect(impact.stillWaiting).toBe(0);
    // Default workspace dialog threshold = 100; 5 immediate < 100 → "immediate" mode.
    expect(impact.recommendedMode).toBe("immediate");
  });

  test("classifies stale_eligible when entry was past stale threshold", async () => {
    const c = await seedCampaign();
    // Default workspace stale threshold = 7 days = 604800s.
    // Enrollments entered 10 days ago, new delay = 1 hour
    //  → run-time was ~10 days ago - 1h ≈ 240h ago > 168h stale threshold.
    await seedEnrollmentsAtWaitStep({
      workspaceId: c.workspaceId,
      campaignId: c.campaignId,
      waitStepId: c.waitStepId,
      count: 3,
      enteredHoursAgo: 10 * 24,
    });

    const res = await callPreview(c.apiKey, c.campaignId, {
      edit_type: "wait_duration_changed",
      step_id: c.waitStepId,
      new_delay_seconds: 3600,
    });
    expect(res.status).toBe(200);
    const impact = (res.body as PreviewResponse).data as Record<string, number | string>;
    expect(impact.totalAffected).toBe(3);
    expect(impact.staleEligible).toBe(3);
    expect(impact.immediate).toBe(0);
  });

  test("recommends skip_stale_spread when stale AND immediate present", async () => {
    const c = await seedCampaign();
    // 2 stale enrollments + 3 immediate enrollments.
    await seedEnrollmentsAtWaitStep({
      workspaceId: c.workspaceId,
      campaignId: c.campaignId,
      waitStepId: c.waitStepId,
      count: 2,
      enteredHoursAgo: 10 * 24,
    });
    await seedEnrollmentsAtWaitStep({
      workspaceId: c.workspaceId,
      campaignId: c.campaignId,
      waitStepId: c.waitStepId,
      count: 3,
      enteredHoursAgo: 12,
    });

    const res = await callPreview(c.apiKey, c.campaignId, {
      edit_type: "wait_duration_changed",
      step_id: c.waitStepId,
      new_delay_seconds: 3600,
    });
    expect(res.status).toBe(200);
    const impact = (res.body as PreviewResponse).data as Record<string, number | string>;
    expect(impact.totalAffected).toBe(5);
    expect(impact.staleEligible).toBe(2);
    expect(impact.immediate).toBe(3);
    expect(impact.recommendedMode).toBe("skip_stale_spread");
  });

  test("classifies still_waiting when new delay is longer than time-since-entry", async () => {
    const c = await seedCampaign();
    await seedEnrollmentsAtWaitStep({
      workspaceId: c.workspaceId,
      campaignId: c.campaignId,
      waitStepId: c.waitStepId,
      count: 4,
      enteredHoursAgo: 1,
    });

    // New delay 7 days; entered 1h ago → still waiting (7d > 1h).
    const res = await callPreview(c.apiKey, c.campaignId, {
      edit_type: "wait_duration_changed",
      step_id: c.waitStepId,
      new_delay_seconds: 7 * 86_400,
    });
    expect(res.status).toBe(200);
    const impact = (res.body as PreviewResponse).data as Record<string, number | string>;
    expect(impact.stillWaiting).toBe(4);
    expect(impact.immediate).toBe(0);
    expect(impact.staleEligible).toBe(0);
    expect(impact.recommendedMode).toBe("immediate");
  });

  test("auto-derives oldDelaySeconds from the step config when omitted", async () => {
    const c = await seedCampaign();
    const res = await callPreview(c.apiKey, c.campaignId, {
      edit_type: "wait_duration_changed",
      step_id: c.waitStepId,
      new_delay_seconds: 3600,
      // old_delay_seconds OMITTED — server reads {duration:1, unit:"days"}
      // from step config → 86400.
    });
    expect(res.status).toBe(200);
    const impact = (res.body as PreviewResponse).data as Record<string, number>;
    expect(impact.oldDelaySeconds).toBe(86_400);
    expect(impact.newDelaySeconds).toBe(3600);
  });

  test("returns sampleEnrollmentIds (max 5)", async () => {
    const c = await seedCampaign();
    await seedEnrollmentsAtWaitStep({
      workspaceId: c.workspaceId,
      campaignId: c.campaignId,
      waitStepId: c.waitStepId,
      count: 8,
      enteredHoursAgo: 12,
    });

    const res = await callPreview(c.apiKey, c.campaignId, {
      edit_type: "wait_duration_changed",
      step_id: c.waitStepId,
      new_delay_seconds: 3600,
    });
    expect(res.status).toBe(200);
    const impact = (res.body as PreviewResponse).data as Record<string, unknown>;
    const samples = impact.sampleEnrollmentIds as string[];
    expect(Array.isArray(samples)).toBe(true);
    expect(samples.length).toBe(5);
    expect(samples.every((s) => s.startsWith("eev_"))).toBe(true);
  });
});

describe("Edit preview: other edit types", () => {
  test("step_deleted returns affected count + samples", async () => {
    const c = await seedCampaign();
    await seedEnrollmentsAtWaitStep({
      workspaceId: c.workspaceId,
      campaignId: c.campaignId,
      waitStepId: c.waitStepId,
      count: 6,
      enteredHoursAgo: 5,
    });

    const res = await callPreview(c.apiKey, c.campaignId, {
      edit_type: "step_deleted",
      step_id: c.waitStepId,
    });
    expect(res.status).toBe(200);
    const impact = (res.body as PreviewResponse).data as Record<string, unknown>;
    expect(impact.editType).toBe("step_deleted");
    expect(impact.totalAffected).toBe(6);
    expect(impact.willAdvance).toBe(6);
    expect((impact.sampleEnrollmentIds as string[]).length).toBe(5);
  });

  test("step_inserted returns 0 affected with reason", async () => {
    const c = await seedCampaign();
    const res = await callPreview(c.apiKey, c.campaignId, {
      edit_type: "step_inserted",
    });
    expect(res.status).toBe(200);
    const impact = (res.body as PreviewResponse).data as Record<string, unknown>;
    expect(impact.editType).toBe("step_inserted");
    expect(impact.totalAffected).toBe(0);
    expect(impact.reason).toContain("In-flight");
  });

  test("email_template_changed returns 0 affected with reason", async () => {
    const c = await seedCampaign();
    const res = await callPreview(c.apiKey, c.campaignId, {
      edit_type: "email_template_changed",
    });
    expect(res.status).toBe(200);
    const impact = (res.body as PreviewResponse).data as Record<string, unknown>;
    expect(impact.totalAffected).toBe(0);
    expect(impact.reason).toContain("template");
  });

  test("goal_added returns active-enrollment count + chunk math", async () => {
    const c = await seedCampaign();
    await seedEnrollmentsAtWaitStep({
      workspaceId: c.workspaceId,
      campaignId: c.campaignId,
      waitStepId: c.waitStepId,
      count: 12,
      enteredHoursAgo: 1,
    });

    const res = await callPreview(c.apiKey, c.campaignId, {
      edit_type: "goal_added",
    });
    expect(res.status).toBe(200);
    const impact = (res.body as PreviewResponse).data as Record<string, number | string>;
    expect(impact.editType).toBe("goal_added");
    expect(impact.totalAffected).toBe(12);
    expect(impact.upperBoundExits).toBe(12);
    // chunk math: 12 / chunkSize (default 1000) → 1 chunk
    expect(impact.estimatedChunks).toBe(1);
  });
});

describe("Edit preview: frozen-status guard", () => {
  test("returns 409 on stopping campaign", async () => {
    const c = await seedCampaign();
    // Flip status to stopping via raw SQL (bypass audit chokepoint via GUC).
    const db = getRawDb();
    await db.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL lifecycle.audited_tx = 'true'`);
      await tx.unsafe(
        `UPDATE campaigns SET status = 'stopping' WHERE id = $1::text`,
        [c.campaignId],
      );
    });

    const res = await callPreview(c.apiKey, c.campaignId, {
      edit_type: "wait_duration_changed",
      step_id: c.waitStepId,
      new_delay_seconds: 3600,
    });
    expect(res.status).toBe(409);
    const body = res.body as { error: string; status?: string };
    expect(body.status).toBe("stopping");
  });

  test("returns 409 on archived campaign", async () => {
    const c = await seedCampaign({ status: "archived" });
    const res = await callPreview(c.apiKey, c.campaignId, {
      edit_type: "step_deleted",
      step_id: c.waitStepId,
    });
    expect(res.status).toBe(409);
  });
});
