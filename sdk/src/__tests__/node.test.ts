import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenMail, OpenMailError } from "../node/index.js";
import { fixtures } from "./mocks/handlers.js";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server.js";

const BASE = "https://api.openmail.win";

function createSDK(overrides = {}) {
  return new OpenMail({
    apiKey: "om_test_key",
    apiUrl: BASE,
    flushAt: 100, // prevent auto-flush during tests
    flushInterval: 999_999,
    ...overrides,
  });
}

// ─── Constructor ──────────────────────────────────────────────────────────────

describe("OpenMail constructor", () => {
  it("throws if apiKey is missing", () => {
    expect(() => new OpenMail({ apiKey: "" })).toThrow("apiKey is required");
  });

  it("creates instance with required config", () => {
    const sdk = createSDK();
    expect(sdk).toBeInstanceOf(OpenMail);
    expect(sdk.contacts).toBeDefined();
    expect(sdk.broadcasts).toBeDefined();
    expect(sdk.campaigns).toBeDefined();
    expect(sdk.segments).toBeDefined();
    expect(sdk.templates).toBeDefined();
    expect(sdk.analytics).toBeDefined();
    expect(sdk.assets).toBeDefined();
  });
});

// ─── identify() ───────────────────────────────────────────────────────────────

describe("identify()", () => {
  it("creates a contact from email userId", async () => {
    const sdk = createSDK();
    const contact = await sdk.identify("alice@example.com", { plan: "pro" });
    expect(contact.email).toBe("alice@example.com");
  });

  it("maps Segment traits to contact fields", async () => {
    const sdk = createSDK();
    server.use(
      http.post(`${BASE}/api/v1/contacts`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body).toMatchObject({
          email: "alice@example.com",
          firstName: "Alice",
          lastName: "Smith",
        });
        expect((body.attributes as Record<string, unknown>)?.company).toBe("Acme");
        return HttpResponse.json(fixtures.contact, { status: 201 });
      })
    );
    await sdk.identify("alice@example.com", {
      firstName: "Alice",
      lastName: "Smith",
      company: "Acme",
    });
  });

  it("supports snake_case Segment trait names", async () => {
    const sdk = createSDK();
    server.use(
      http.post(`${BASE}/api/v1/contacts`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body).toMatchObject({ firstName: "Alice", lastName: "Smith" });
        return HttpResponse.json(fixtures.contact, { status: 201 });
      })
    );
    await sdk.identify("alice@example.com", {
      first_name: "Alice",
      last_name: "Smith",
    });
  });

  it("throws if email cannot be determined", async () => {
    const sdk = createSDK();
    await expect(sdk.identify("user_123", {})).rejects.toThrow("email is required");
  });

  it("extracts email from traits.email when userId is not an email", async () => {
    const sdk = createSDK();
    server.use(
      http.post(`${BASE}/api/v1/contacts`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body).toMatchObject({ email: "alice@example.com" });
        return HttpResponse.json(fixtures.contact, { status: 201 });
      })
    );
    await sdk.identify("user_123", { email: "alice@example.com", plan: "pro" });
  });

  it("returns null when disabled", async () => {
    const sdk = createSDK({ disabled: true });
    const result = await sdk.identify("alice@example.com", {});
    expect(result).toBeNull();
  });
});

// ─── track() ──────────────────────────────────────────────────────────────────

describe("track()", () => {
  it("queues an event and flushes it", async () => {
    const sdk = createSDK({ flushAt: 1 }); // flush immediately
    const result = await sdk.track("plan_upgraded", { from: "starter" }, {
      userId: "alice@example.com",
    });
    // track() is fire-and-forget — resolves with placeholder id
    expect(result).toMatchObject({ id: "" });
    // Ensure the queue fires (flushAt: 1 triggers immediately on next tick)
    await new Promise((r) => setTimeout(r, 50));
    await sdk.flush();
  });

  it("throws if no userId is provided", async () => {
    const sdk = createSDK();
    await expect(sdk.track("plan_upgraded")).rejects.toThrow("userId (email) is required");
  });

  it("uses previously set userId from identify", async () => {
    const sdk = createSDK({ flushAt: 1 });
    await sdk.identify("alice@example.com", {});
    const result = await sdk.track("plan_upgraded", { plan: "pro" });
    expect(result).toMatchObject({ id: "" }); // fire-and-forget returns placeholder
    await sdk.flush();
  });

  it("sends correct payload to API", async () => {
    const sdk = createSDK({ flushAt: 1 });
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.post(`${BASE}/api/v1/events/track`, async ({ request }) => {
        captured = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ id: "evt_test" }, { status: 201 });
      })
    );
    await sdk.track("plan_upgraded", { from: "starter", to: "pro" }, {
      userId: "alice@example.com",
    });
    await new Promise((r) => setTimeout(r, 50));
    await sdk.flush();
    expect(captured).toMatchObject({
      email: "alice@example.com",
      name: "plan_upgraded",
      properties: { from: "starter", to: "pro" },
    });
  });

  it("returns empty result when disabled", async () => {
    const sdk = createSDK({ disabled: true });
    const result = await sdk.track("test", {}, { userId: "alice@example.com" });
    expect(result).toEqual({ id: "" });
  });

  it("capture(event) is an alias for track", async () => {
    const sdk = createSDK({ flushAt: 1 });
    await sdk.identify("alice@example.com", {});
    const result = await sdk.capture("test_event", { key: "val" });
    expect(result).toMatchObject({ id: "" }); // fire-and-forget
    await sdk.flush();
  });
});

// ─── page() / screen() ────────────────────────────────────────────────────────

describe("page() and screen()", () => {
  it("tracks $pageview event", async () => {
    const sdk = createSDK({ flushAt: 1 });
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.post(`${BASE}/api/v1/events/track`, async ({ request }) => {
        captured = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ id: "evt_page" });
      })
    );
    await sdk.page("Home", { path: "/" }, { userId: "alice@example.com" });
    await new Promise((r) => setTimeout(r, 50));
    await sdk.flush();
    expect(captured).toMatchObject({ name: "$pageview" });
  });

  it("tracks $screen event", async () => {
    const sdk = createSDK({ flushAt: 1 });
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.post(`${BASE}/api/v1/events/track`, async ({ request }) => {
        captured = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ id: "evt_screen" });
      })
    );
    await sdk.screen("Dashboard", {}, { userId: "alice@example.com" });
    await new Promise((r) => setTimeout(r, 50));
    await sdk.flush();
    expect(captured).toMatchObject({ name: "$screen" });
  });
});

// ─── group() ──────────────────────────────────────────────────────────────────

describe("group()", () => {
  it("calls /api/ingest/group with correct payload", async () => {
    const sdk = createSDK({ flushAt: 1 });
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.post(`${BASE}/api/ingest/group`, async ({ request }) => {
        captured = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ success: true });
      })
    );
    await sdk.group("acme-corp", { name: "Acme Corp" }, { userId: "alice@example.com" });
    await new Promise((r) => setTimeout(r, 50));
    expect(captured).toMatchObject({
      groupType: "company",
      groupKey: "acme-corp",
      attributes: { name: "Acme Corp" },
      contactEmail: "alice@example.com",
    });
  });
});

// ─── alias() ──────────────────────────────────────────────────────────────────

describe("alias()", () => {
  it("tracks $alias event", async () => {
    const sdk = createSDK({ flushAt: 1 });
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.post(`${BASE}/api/v1/events/track`, async ({ request }) => {
        captured = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ id: "evt_alias" });
      })
    );
    await sdk.alias("alice@example.com", "anon_123");
    await new Promise((r) => setTimeout(r, 50));
    await sdk.flush();
    expect(captured).toMatchObject({
      name: "$alias",
      properties: { userId: "alice@example.com", previousId: "anon_123" },
    });
  });
});

// ─── reset() ──────────────────────────────────────────────────────────────────

describe("reset()", () => {
  it("clears the current userId", async () => {
    const sdk = createSDK();
    await sdk.identify("alice@example.com", {});
    sdk.reset();
    // After reset, track() should throw without userId
    await expect(sdk.track("test")).rejects.toThrow("userId (email) is required");
  });
});

// ─── opt in/out ───────────────────────────────────────────────────────────────

describe("opt_in_capturing / opt_out_capturing", () => {
  it("silently drops events when opted out", async () => {
    const sdk = createSDK({ flushAt: 1 });
    sdk.opt_out_capturing();
    const result = await sdk.track("test", {}, { userId: "alice@example.com" });
    expect(result).toEqual({ id: "" });
  });

  it("resumes tracking after opt_in", async () => {
    const sdk = createSDK({ flushAt: 1 });
    sdk.opt_out_capturing();
    sdk.opt_in_capturing();
    await sdk.identify("alice@example.com", {});
    const result = await sdk.track("test", {});
    expect(result).toMatchObject({ id: expect.any(String) });
  });
});

// ─── Contacts API ─────────────────────────────────────────────────────────────

describe("contacts API", () => {
  it("lists contacts with pagination", async () => {
    const sdk = createSDK();
    const result = await sdk.contacts.list({ page: 1, pageSize: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.data[0].email).toBe("alice@example.com");
  });

  it("creates a contact", async () => {
    const sdk = createSDK();
    const contact = await sdk.contacts.create({ email: "bob@example.com" });
    expect(contact.email).toBe("bob@example.com");
  });

  it("gets a contact by ID", async () => {
    const sdk = createSDK();
    const contact = await sdk.contacts.get("con_abc123def456");
    expect(contact.id).toBe("con_abc123def456");
  });

  it("throws NOT_FOUND for missing contact", async () => {
    const sdk = createSDK();
    await expect(sdk.contacts.get("not_found")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("updates a contact", async () => {
    const sdk = createSDK();
    const contact = await sdk.contacts.update("con_abc123def456", {
      firstName: "Alicia",
    });
    expect(contact.firstName).toBe("Alicia");
  });

  it("deletes a contact", async () => {
    const sdk = createSDK();
    await expect(sdk.contacts.delete("con_abc123def456")).resolves.not.toThrow();
  });

  it("lists contact events", async () => {
    const sdk = createSDK();
    const result = await sdk.contacts.events("con_abc123def456");
    expect(result.data).toBeInstanceOf(Array);
  });

  it("lists contact sends", async () => {
    const sdk = createSDK();
    const result = await sdk.contacts.sends("con_abc123def456");
    expect(result.data).toBeInstanceOf(Array);
  });
});

// ─── Broadcasts API ───────────────────────────────────────────────────────────

describe("broadcasts API", () => {
  it("lists broadcasts", async () => {
    const sdk = createSDK();
    const result = await sdk.broadcasts.list();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("brd_abc123def456");
  });

  it("creates a broadcast", async () => {
    const sdk = createSDK();
    const broadcast = await sdk.broadcasts.create({
      name: "Test",
      subject: "Hello",
      segmentIds: ["seg_abc123"],
      htmlContent: "<p>Hello</p>",
    });
    expect(broadcast.name).toBe("Test");
  });

  it("sends a broadcast", async () => {
    const sdk = createSDK();
    const result = await sdk.broadcasts.send("brd_abc123def456");
    expect(result.status).toBe("sending");
  });

  it("schedules a broadcast via PATCH", async () => {
    const sdk = createSDK();
    server.use(
      http.patch(`${BASE}/api/v1/broadcasts/:id`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body).toMatchObject({ scheduledAt: "2025-12-25T09:00:00Z" });
        return HttpResponse.json({ ...fixtures.broadcast, scheduledAt: "2025-12-25T09:00:00Z", status: "scheduled" });
      })
    );
    const result = await sdk.broadcasts.schedule("brd_abc123def456", "2025-12-25T09:00:00Z");
    expect(result.status).toBe("scheduled");
  });

  it("clears schedule with null", async () => {
    const sdk = createSDK();
    server.use(
      http.patch(`${BASE}/api/v1/broadcasts/:id`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.scheduledAt).toBeNull();
        return HttpResponse.json(fixtures.broadcast);
      })
    );
    await sdk.broadcasts.schedule("brd_abc123def456", null);
  });

  it("sends test email", async () => {
    const sdk = createSDK();
    const result = await sdk.broadcasts.testSend("brd_abc123def456", "test@example.com");
    expect(result.success).toBe(true);
  });

  it("gets top links", async () => {
    const sdk = createSDK();
    const links = await sdk.broadcasts.topLinks("brd_abc123def456");
    expect(links[0]).toMatchObject({ url: "https://example.com", clicks: 42 });
  });

  it("deletes a broadcast", async () => {
    const sdk = createSDK();
    await expect(sdk.broadcasts.delete("brd_abc123def456")).resolves.not.toThrow();
  });
});

// ─── Campaigns API ────────────────────────────────────────────────────────────

describe("campaigns API", () => {
  it("lists campaigns", async () => {
    const sdk = createSDK();
    const campaigns = await sdk.campaigns.list();
    expect(campaigns[0].id).toBe("cmp_abc123def456");
  });

  it("creates a campaign with event trigger", async () => {
    const sdk = createSDK();
    const campaign = await sdk.campaigns.create({
      name: "Welcome",
      triggerType: "event",
      triggerConfig: { eventName: "user_signed_up" },
    });
    expect(campaign.triggerType).toBe("event");
  });

  it("activates a campaign", async () => {
    const sdk = createSDK();
    server.use(
      http.patch(`${BASE}/api/v1/campaigns/:id`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.status).toBe("active");
        return HttpResponse.json({ ...fixtures.campaign, status: "active" });
      })
    );
    const result = await sdk.campaigns.activate("cmp_abc123def456");
    expect(result.status).toBe("active");
  });

  it("pauses a campaign", async () => {
    const sdk = createSDK();
    server.use(
      http.patch(`${BASE}/api/v1/campaigns/:id`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.status).toBe("paused");
        return HttpResponse.json({ ...fixtures.campaign, status: "paused" });
      })
    );
    const result = await sdk.campaigns.pause("cmp_abc123def456");
    expect(result.status).toBe("paused");
  });

  it("adds a step to a campaign", async () => {
    const sdk = createSDK();
    const step = await sdk.campaigns.addStep("cmp_abc123def456", {
      stepType: "email",
      config: { templateId: "tpl_welcome" },
    });
    expect(step.stepType).toBe("email");
  });

  it("updates a step", async () => {
    const sdk = createSDK();
    const step = await sdk.campaigns.updateStep("cmp_abc123def456", "stp_test", {
      config: { templateId: "tpl_new" },
    });
    expect(step).toBeDefined();
  });

  it("deletes a step", async () => {
    const sdk = createSDK();
    await expect(
      sdk.campaigns.deleteStep("cmp_abc123def456", "stp_test")
    ).resolves.not.toThrow();
  });
});

// ─── Segments API ─────────────────────────────────────────────────────────────

describe("segments API", () => {
  it("lists segments", async () => {
    const sdk = createSDK();
    const segments = await sdk.segments.list();
    expect(segments[0].name).toBe("Pro Users");
  });

  it("creates a segment with conditions", async () => {
    const sdk = createSDK();
    const segment = await sdk.segments.create({
      name: "Enterprise",
      conditions: [{ field: "attributes.plan", operator: "eq", value: "enterprise" }],
    });
    expect(segment.name).toBe("Enterprise");
  });

  it("lists segment members", async () => {
    const sdk = createSDK();
    const result = await sdk.segments.members("seg_abc123def456");
    expect(result.data).toHaveLength(1);
  });

  it("gets segment usage", async () => {
    const sdk = createSDK();
    const usage = await sdk.segments.usage("seg_abc123def456");
    expect(usage.broadcasts).toBeInstanceOf(Array);
    expect(usage.campaigns).toBeInstanceOf(Array);
  });
});

// ─── Templates API ────────────────────────────────────────────────────────────

describe("templates API", () => {
  it("creates a template", async () => {
    const sdk = createSDK();
    const tpl = await sdk.templates.create({
      name: "Welcome",
      subject: "Welcome!",
      htmlContent: "<p>Hello</p>",
    });
    expect(tpl.name).toBe("Welcome");
  });
});

// ─── Analytics API ────────────────────────────────────────────────────────────

describe("analytics API", () => {
  it("returns overview stats with correct field names", async () => {
    const sdk = createSDK();
    const stats = await sdk.analytics.overview();
    // Field names match actual API: contacts (not totalContacts), sends (not totalSends)
    expect((stats as unknown as Record<string, unknown>).contacts).toBe(1000);
    expect((stats as unknown as Record<string, unknown>).openRate).toBe(25.0); // percent, not fraction
    expect((stats as unknown as Record<string, unknown>).period).toBe("30d");
  });

  it("returns broadcast analytics with percentage openRate", async () => {
    const sdk = createSDK();
    const stats = await sdk.analytics.broadcast("brd_abc123def456");
    expect(stats.openRate).toBe(24.3); // percent, not fraction
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe("error handling", () => {
  it("throws UNAUTHORIZED on 401", async () => {
    const sdk = new OpenMail({
      apiKey: "om_bad_key",
      apiUrl: BASE,
      maxRetries: 0,
    });
    server.use(
      http.get(`${BASE}/api/v1/contacts`, () =>
        HttpResponse.json({ error: "Invalid API key" }, { status: 401 })
      )
    );
    await expect(sdk.contacts.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("throws NOT_FOUND on 404", async () => {
    const sdk = createSDK();
    await expect(sdk.contacts.get("not_found")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws VALIDATION_ERROR on 400", async () => {
    const sdk = createSDK();
    server.use(
      http.post(`${BASE}/api/v1/contacts`, () =>
        HttpResponse.json({ error: "Email is required" }, { status: 400 })
      )
    );
    await expect(sdk.contacts.create({ email: "" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("retries on 500 and succeeds", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/api/v1/contacts`, () => {
        calls++;
        if (calls < 3) return HttpResponse.json({}, { status: 500 });
        return HttpResponse.json({ data: [fixtures.contact], total: 1, page: 1, pageSize: 50 });
      })
    );
    const sdk = new OpenMail({ apiKey: "om_test_key", apiUrl: BASE, maxRetries: 3 });
    const result = await sdk.contacts.list();
    expect(calls).toBe(3);
    expect(result.data).toHaveLength(1);
  });

  it("OpenMailError.fromResponse creates correct error types", () => {
    const err401 = OpenMailError.fromResponse(401, { error: "Bad key" });
    expect(err401.code).toBe("UNAUTHORIZED");

    const err404 = OpenMailError.fromResponse(404, { error: "Not found" });
    expect(err404.code).toBe("NOT_FOUND");

    const err400 = OpenMailError.fromResponse(400, { error: "Invalid" });
    expect(err400.code).toBe("VALIDATION_ERROR");

    const err500 = OpenMailError.fromResponse(500, { error: "Server error" });
    expect(err500.code).toBe("SERVER_ERROR");
  });
});

// ─── flush / shutdown ─────────────────────────────────────────────────────────

describe("flush() and shutdown()", () => {
  it("flushes pending events", async () => {
    const sdk = createSDK();
    await sdk.identify("alice@example.com", {});
    sdk.track("test_flush", {}); // non-blocking
    // Wait a tick for the item to land in the queue
    await new Promise((r) => setTimeout(r, 10));
    expect(sdk.queuedEvents).toBe(1);
    await sdk.flush();
    expect(sdk.queuedEvents).toBe(0);
  }, 10_000);

  it("shutdown flushes and destroys queue", async () => {
    const sdk = createSDK();
    await sdk.shutdown();
    expect(sdk.queuedEvents).toBe(0);
  });
});
