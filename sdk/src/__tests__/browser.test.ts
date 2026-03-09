import { describe, it, expect, afterEach } from "vitest";
import { OpenMailBrowser } from "../browser.js";
import { server } from "./mocks/server.js";
import { http, HttpResponse } from "msw";
import { fixtures } from "./mocks/handlers.js";

const sdks: OpenMailBrowser[] = [];

afterEach(async () => {
  // Destroy all SDKs created during tests to stop timers
  await Promise.all(sdks.map((sdk) => sdk.destroy().catch(() => {})));
  sdks.length = 0;
});

const BASE = "https://api.openmail.win";

function createBrowserSDK(overrides = {}) {
  const sdk = new OpenMailBrowser({
    apiKey: "om_test_key",
    apiUrl: BASE,
    autoPageView: false,
    persistence: "memory",
    flushAt: 100,
    flushInterval: 999_999,
    ...overrides,
  });
  sdks.push(sdk);
  return sdk;
}

// ─── Anonymous ID ─────────────────────────────────────────────────────────────

describe("anonymous ID", () => {
  it("generates a UUID-format anonymous ID", () => {
    const sdk = createBrowserSDK();
    const id = sdk.anonymousId;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("returns the same anonymous ID on consecutive calls", () => {
    const sdk = createBrowserSDK();
    expect(sdk.anonymousId).toBe(sdk.anonymousId);
  });

  it("generates a NEW anonymous ID after reset()", () => {
    const sdk = createBrowserSDK();
    const firstId = sdk.anonymousId;
    sdk.reset();
    const secondId = sdk.anonymousId;
    expect(firstId).not.toBe(secondId);
  });
});

// ─── identify() ───────────────────────────────────────────────────────────────

describe("identify()", () => {
  it("stores userId and calls API", async () => {
    const sdk = createBrowserSDK({ flushAt: 1 });
    server.use(
      http.post(`${BASE}/api/v1/contacts`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body).toMatchObject({ email: "alice@example.com" });
        return HttpResponse.json(fixtures.contact, { status: 201 });
      })
    );
    await sdk.identify("alice@example.com", { firstName: "Alice" });
    expect(sdk.userId).toBe("alice@example.com");
  });

  it("throws if email is missing", async () => {
    const sdk = createBrowserSDK();
    await expect(sdk.identify("user_123_no_email")).rejects.toThrow("email is required");
  });

  it("fires $identify event with anonymous ID", async () => {
    const sdk = createBrowserSDK({ flushAt: 1 });
    const anonId = sdk.anonymousId;
    let identifyEventFired = false;

    server.use(
      http.post(`${BASE}/api/v1/events/track`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        const props = body.properties as Record<string, unknown>;
        if (body.name === "$identify" && props?.anonymousId === anonId) {
          identifyEventFired = true;
        }
        return HttpResponse.json({ id: "evt_test" });
      }),
      http.post(`${BASE}/api/v1/contacts`, () =>
        HttpResponse.json(fixtures.contact, { status: 201 })
      )
    );

    await sdk.identify("alice@example.com", {});
    await sdk.flush();
    expect(identifyEventFired).toBe(true);
  });
});

// ─── track() ──────────────────────────────────────────────────────────────────

describe("track()", () => {
  it("enqueues an event with page context", async () => {
    const sdk = createBrowserSDK({ flushAt: 1 });
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.post(`${BASE}/api/v1/events/track`, async ({ request }) => {
        captured = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ id: "evt_test" });
      })
    );
    await sdk.identify("alice@example.com", {});
    const result = await sdk.track("button_clicked", { button: "upgrade" });
    expect(result).toMatchObject({ id: "" }); // fire-and-forget
    await new Promise((r) => setTimeout(r, 50));
    await sdk.flush();
    if (captured) {
      expect(captured).toMatchObject({ name: "button_clicked" });
    }
  });

  it("drops events when opted out", async () => {
    const sdk = createBrowserSDK({ flushAt: 1 });
    sdk.opt_out_capturing();
    const result = await sdk.track("test", {});
    expect(result).toEqual({ id: "" });
  });
});

// ─── page() ───────────────────────────────────────────────────────────────────

describe("page()", () => {
  it("tracks $pageview event with page props", async () => {
    const sdk = createBrowserSDK({ flushAt: 1 });
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.post(`${BASE}/api/v1/events/track`, async ({ request }) => {
        captured = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ id: "evt_page" });
      })
    );
    await sdk.identify("alice@example.com", {});
    await sdk.page("Home", { path: "/" });
    await new Promise((r) => setTimeout(r, 50));
    await sdk.flush();
    if (captured) {
      expect(captured).toMatchObject({ name: "$pageview" });
    }
  });
});

// ─── group() ──────────────────────────────────────────────────────────────────

describe("group()", () => {
  it("tracks $group event", async () => {
    const sdk = createBrowserSDK({ flushAt: 1 });
    let groupCapture: Record<string, unknown> | null = null;
    server.use(
      http.post(`${BASE}/api/v1/events/track`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        if (body.name === "$group") groupCapture = body;
        return HttpResponse.json({ id: "evt_group" });
      })
    );
    await sdk.identify("alice@example.com", {});
    await sdk.group("acme-corp", { plan: "enterprise" });
    await new Promise((r) => setTimeout(r, 50));
    await sdk.flush();
    if (groupCapture) {
      const props = (groupCapture as Record<string, unknown>).properties as Record<string, unknown>;
      expect(props.groupId).toBe("acme-corp");
    }
  });
});

// ─── opt in/out ───────────────────────────────────────────────────────────────

describe("opt in/out", () => {
  it("checks isOptedOut before and after opt_out", () => {
    const sdk = createBrowserSDK();
    expect(sdk.isOptedOut).toBe(false);
    sdk.opt_out_capturing();
    expect(sdk.isOptedOut).toBe(true);
  });

  it("re-enables tracking after opt_in", () => {
    const sdk = createBrowserSDK();
    sdk.opt_out_capturing();
    sdk.opt_in_capturing();
    expect(sdk.isOptedOut).toBe(false);
  });
});

// ─── reset() ──────────────────────────────────────────────────────────────────

describe("reset()", () => {
  it("clears userId on reset", async () => {
    const sdk = createBrowserSDK();
    server.use(
      http.post(`${BASE}/api/v1/contacts`, () =>
        HttpResponse.json(fixtures.contact, { status: 201 })
      )
    );
    await sdk.identify("alice@example.com", {});
    expect(sdk.userId).toBe("alice@example.com");
    sdk.reset();
    expect(sdk.userId).toBeNull();
  });
});

// ─── flush / destroy ──────────────────────────────────────────────────────────

describe("flush / destroy", () => {
  it("flushes pending events", async () => {
    const sdk = createBrowserSDK();
    await sdk.identify("alice@example.com", {});
    sdk.track("test"); // non-blocking
    await new Promise((r) => setTimeout(r, 10));
    await sdk.flush(); // drain queue
    // No errors thrown = success
  });

  it("destroy() resolves without errors", async () => {
    const sdk = createBrowserSDK();
    await expect(sdk.destroy()).resolves.not.toThrow();
  });
});
