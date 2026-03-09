import { http, HttpResponse } from "msw";

const BASE = "https://api.openmail.win";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

export const fixtures = {
  contact: {
    id: "con_abc123def456",
    workspaceId: "ws_test",
    email: "alice@example.com",
    firstName: "Alice",
    lastName: "Smith",
    phone: null,
    attributes: { plan: "pro" },
    unsubscribed: false,
    unsubscribedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  event: {
    id: "evt_abc123def456",
  },
  broadcast: {
    id: "brd_abc123def456",
    workspaceId: "ws_test",
    name: "Test Broadcast",
    subject: "Hello!",
    status: "draft" as const,
    segmentIds: ["seg_abc123"],
    templateId: null,
    htmlContent: "<p>Hello</p>",
    fromEmail: null,
    fromName: null,
    recipientCount: 0,
    sentCount: 0,
    openCount: 0,
    clickCount: 0,
    scheduledAt: null,
    sentAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  campaign: {
    id: "cmp_abc123def456",
    workspaceId: "ws_test",
    name: "Welcome Campaign",
    description: null,
    status: "draft" as const,
    triggerType: "event" as const,
    triggerConfig: { eventName: "user_signed_up" },
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    steps: [],
  },
  segment: {
    id: "seg_abc123def456",
    workspaceId: "ws_test",
    name: "Pro Users",
    description: null,
    conditions: [{ field: "attributes.plan", operator: "eq" as const, value: "pro" }],
    conditionLogic: "and" as const,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  template: {
    id: "tpl_abc123def456",
    workspaceId: "ws_test",
    name: "Welcome Email",
    subject: "Welcome!",
    previewText: null,
    htmlContent: "<h1>Welcome!</h1>",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  analytics: {
    totalContacts: 1000,
    newContactsLast30Days: 50,
    totalSends: 5000,
    openRate: 0.25,
    clickRate: 0.05,
    unsubscribeRate: 0.01,
    periodStart: "2025-01-01T00:00:00.000Z",
    periodEnd: "2025-01-31T23:59:59.000Z",
  },
};

// ─── Handlers ─────────────────────────────────────────────────────────────────

export const handlers = [
  // Contacts
  http.get(`${BASE}/api/v1/contacts`, () =>
    HttpResponse.json({ data: [fixtures.contact], total: 1, page: 1, pageSize: 50 })
  ),
  http.post(`${BASE}/api/v1/contacts`, async ({ request }) => {
    const body = await request.json() as { email?: string };
    return HttpResponse.json({ ...fixtures.contact, email: body?.email ?? fixtures.contact.email }, { status: 201 });
  }),
  http.get(`${BASE}/api/v1/contacts/:id`, ({ params }) =>
    params.id === "not_found"
      ? HttpResponse.json({ error: "Not found" }, { status: 404 })
      : HttpResponse.json(fixtures.contact)
  ),
  http.patch(`${BASE}/api/v1/contacts/:id`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...fixtures.contact, ...body });
  }),
  http.delete(`${BASE}/api/v1/contacts/:id`, () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.get(`${BASE}/api/v1/contacts/:id/events`, () =>
    HttpResponse.json({ data: [], total: 0, page: 1, pageSize: 50 })
  ),
  http.get(`${BASE}/api/v1/contacts/:id/sends`, () =>
    HttpResponse.json({ data: [], total: 0, page: 1, pageSize: 50 })
  ),

  // Events
  http.post(`${BASE}/api/v1/events/track`, async ({ request }) => {
    const body = await request.json() as { name?: string };
    return HttpResponse.json({ id: "evt_" + (body?.name ?? "test") }, { status: 201 });
  }),

  // Broadcasts
  http.get(`${BASE}/api/v1/broadcasts`, () =>
    HttpResponse.json([fixtures.broadcast])
  ),
  http.post(`${BASE}/api/v1/broadcasts`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...fixtures.broadcast, ...body }, { status: 201 });
  }),
  http.get(`${BASE}/api/v1/broadcasts/:id`, ({ params }) =>
    params.id === "not_found"
      ? HttpResponse.json({ error: "Not found" }, { status: 404 })
      : HttpResponse.json(fixtures.broadcast)
  ),
  http.patch(`${BASE}/api/v1/broadcasts/:id`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...fixtures.broadcast, ...body });
  }),
  http.post(`${BASE}/api/v1/broadcasts/:id/send`, () =>
    HttpResponse.json({ ...fixtures.broadcast, status: "sending" })
  ),
  http.post(`${BASE}/api/v1/broadcasts/:id/test-send`, () =>
    HttpResponse.json({ success: true })
  ),
  http.delete(`${BASE}/api/v1/broadcasts/:id`, () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.get(`${BASE}/api/v1/broadcasts/:id/sends`, () =>
    HttpResponse.json({ data: [], total: 0, page: 1, pageSize: 50 })
  ),
  http.get(`${BASE}/api/v1/broadcasts/:id/top-links`, () =>
    HttpResponse.json([{ url: "https://example.com", clicks: 42 }])
  ),

  // Campaigns
  http.get(`${BASE}/api/v1/campaigns`, () =>
    HttpResponse.json([fixtures.campaign])
  ),
  http.post(`${BASE}/api/v1/campaigns`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...fixtures.campaign, ...body }, { status: 201 });
  }),
  http.get(`${BASE}/api/v1/campaigns/:id`, () =>
    HttpResponse.json(fixtures.campaign)
  ),
  http.patch(`${BASE}/api/v1/campaigns/:id`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...fixtures.campaign, ...body });
  }),
  http.delete(`${BASE}/api/v1/campaigns/:id`, () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.post(`${BASE}/api/v1/campaigns/:id/steps`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({
      id: "stp_test",
      campaignId: "cmp_abc123def456",
      stepType: "email",
      position: 0,
      config: {},
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      ...body,
    }, { status: 201 });
  }),
  http.patch(`${BASE}/api/v1/campaigns/:id/steps/:stepId`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ id: "stp_test", ...body });
  }),
  http.delete(`${BASE}/api/v1/campaigns/:id/steps/:stepId`, () =>
    new HttpResponse(null, { status: 204 })
  ),

  // Segments
  http.get(`${BASE}/api/v1/segments`, () =>
    HttpResponse.json([fixtures.segment])
  ),
  http.post(`${BASE}/api/v1/segments`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...fixtures.segment, ...body }, { status: 201 });
  }),
  http.patch(`${BASE}/api/v1/segments/:id`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...fixtures.segment, ...body });
  }),
  http.delete(`${BASE}/api/v1/segments/:id`, () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.get(`${BASE}/api/v1/segments/:id/people`, () =>
    HttpResponse.json({ data: [fixtures.contact], total: 1, page: 1, pageSize: 50 })
  ),
  http.get(`${BASE}/api/v1/segments/:id/usage`, () =>
    HttpResponse.json({ broadcasts: [], campaigns: [] })
  ),

  // Templates
  http.get(`${BASE}/api/v1/templates`, () =>
    HttpResponse.json([fixtures.template])
  ),
  http.post(`${BASE}/api/v1/templates`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...fixtures.template, ...body }, { status: 201 });
  }),
  http.patch(`${BASE}/api/v1/templates/:id`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...fixtures.template, ...body });
  }),
  http.delete(`${BASE}/api/v1/templates/:id`, () =>
    new HttpResponse(null, { status: 204 })
  ),

  // Analytics
  http.get(`${BASE}/api/v1/analytics/overview`, () =>
    HttpResponse.json(fixtures.analytics)
  ),
  http.get(`${BASE}/api/v1/analytics/broadcasts/:id`, () =>
    HttpResponse.json({ broadcastId: "brd_abc123def456", openRate: 0.25, clickRate: 0.05, ...fixtures.analytics })
  ),

  // Assets
  http.get(`${BASE}/api/v1/assets`, () =>
    HttpResponse.json([])
  ),
  http.post(`${BASE}/api/v1/assets/upload-from-url`, async ({ request }) => {
    const body = await request.json() as { name?: string; url?: string };
    return HttpResponse.json({
      id: "ast_test",
      name: body?.name ?? null,
      fileName: "image.png",
      mimeType: "image/png",
      size: 1024,
      proxyUrl: `https://api.openmail.win/api/public/assets/ws_test/ast_test`,
      createdAt: "2025-01-01T00:00:00.000Z",
    }, { status: 201 });
  }),
];
