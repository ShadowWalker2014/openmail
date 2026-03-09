# @openmail/sdk

> Official TypeScript SDK for [OpenMail](https://openmail.win) — track events, identify users, and manage email campaigns. Compatible with **Segment Analytics 2.0** and **PostHog** interfaces, so migration is a single line change.

[![npm version](https://img.shields.io/npm/v/@openmail/sdk)](https://www.npmjs.com/package/@openmail/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@openmail/sdk)](https://www.npmjs.com/package/@openmail/sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License: ELv2](https://img.shields.io/badge/License-ELv2-blue.svg)](https://www.elastic.co/licensing/elastic-license)

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Node.js SDK](#nodejs--server-side)
- [Browser SDK](#browser)
- [React SDK](#react)
- [Next.js SDK](#nextjs)
- [PostHog Migration](#migrate-from-posthog)
- [Customer.io Migration](#migrate-from-customerio)
- [Segment Migration](#migrate-from-segment)
- [Full API Reference](#full-api-reference)
- [Error Handling](#error-handling)
- [Configuration](#configuration)

---

## Installation

```bash
# npm
npm install @openmail/sdk

# bun (recommended)
bun add @openmail/sdk

# pnpm
pnpm add @openmail/sdk

# yarn
yarn add @openmail/sdk
```

**Requirements:** Node.js 18+ (uses native `fetch`)

---

## Quick Start

Get your API key from the OpenMail dashboard → **Settings → API Keys**.

```ts
import { OpenMail } from "@openmail/sdk";

const openmail = new OpenMail({
  apiKey: process.env.OPENMAIL_API_KEY!, // om_your_workspace_api_key
});

// Identify a user (creates or updates a contact)
await openmail.identify("alice@example.com", {
  firstName: "Alice",
  plan: "pro",
  company: "Acme Corp",
});

// Track an event (triggers matching campaign automations)
await openmail.track("plan_upgraded", {
  from_plan: "starter",
  to_plan: "pro",
  mrr: 99,
}, { userId: "alice@example.com" });

// Always flush before process exit
await openmail.flush();
```

---

## Node.js / Server-side

Import from `@openmail/sdk`:

```ts
import { OpenMail } from "@openmail/sdk";

const openmail = new OpenMail({
  apiKey: process.env.OPENMAIL_API_KEY!,
  // All options below are optional:
  apiUrl: "https://api.openmail.win",  // Default — your self-hosted URL
  flushAt: 20,           // Events to buffer before auto-flush
  flushInterval: 10_000, // Max ms between flushes (10s)
  maxRetries: 3,         // Retries on 5xx/429/408 errors
  timeout: 10_000,       // Request timeout in ms
  disabled: false,       // Set true in test environments
  debug: false,          // Log all requests/responses
});
```

### Core tracking methods

```ts
// identify() — create or update a contact
// Called with: email (or userId + traits.email), plus any custom traits
await openmail.identify("alice@example.com", {
  firstName: "Alice",
  lastName: "Smith",
  phone: "+1-555-0100",
  plan: "pro",            // → stored in contact.attributes.plan
  company: "Acme Corp",   // → stored in contact.attributes.company
  mrr: 99,                // → stored in contact.attributes.mrr
});

// track() — record a user event; triggers matching campaigns
// fire-and-forget: returns immediately, batched internally
await openmail.track("invoice_paid", {
  amount: 99,
  currency: "usd",
  invoice_id: "inv_123",
}, {
  userId: "alice@example.com",  // required if identify() wasn't called first
  timestamp: "2025-03-01T09:00:00Z",  // optional: backdated events
});

// page() — track a server-side page view
await openmail.page("Pricing", { path: "/pricing" }, { userId: "alice@example.com" });

// group() — associate a user with an organization
await openmail.group("acme-corp", {
  name: "Acme Corp",
  plan: "enterprise",
  seats: 50,
}, { userId: "alice@example.com" });

// PostHog alias: capture() = track()
await openmail.capture("button_clicked", { button: "upgrade" });

// Reset the current user context (call on logout)
openmail.reset();

// Opt out of tracking (events silently dropped)
openmail.opt_out_capturing();
openmail.opt_in_capturing();
```

### Flush and shutdown

```ts
// Flush buffered events — call before process.exit()
await openmail.flush();

// Shutdown: flush + clean up timer
await openmail.shutdown();

// Check how many events are waiting to be sent
console.log(openmail.queuedEvents); // number
```

### Full API access

The SDK includes typed sub-clients for all OpenMail resources:

```ts
// Contacts
const { data, total } = await openmail.contacts.list({ page: 1, pageSize: 50, search: "@acme.com" });
const contact = await openmail.contacts.create({ email: "bob@acme.com" });
const contact = await openmail.contacts.get("con_abc123");
await openmail.contacts.update("con_abc123", { attributes: { plan: "enterprise" } });
await openmail.contacts.delete("con_abc123");
const events = await openmail.contacts.events("con_abc123");
const sends = await openmail.contacts.sends("con_abc123");

// Broadcasts
const broadcasts = await openmail.broadcasts.list();
const broadcast = await openmail.broadcasts.create({
  name: "March Newsletter",
  subject: "What's new 🌱",
  segmentIds: ["seg_abc123"],
  htmlContent: "<h1>Hello!</h1>",
  fromEmail: "hello@acme.com",
  fromName: "Acme Team",
});
await openmail.broadcasts.send(broadcast.id);
await openmail.broadcasts.schedule(broadcast.id, "2025-03-15T09:00:00Z");
await openmail.broadcasts.testSend(broadcast.id, "preview@acme.com");
const topLinks = await openmail.broadcasts.topLinks(broadcast.id);

// Campaigns
const campaign = await openmail.campaigns.create({
  name: "Welcome Series",
  triggerType: "event",
  triggerConfig: { eventName: "user_signed_up" },
});
await openmail.campaigns.addStep(campaign.id, {
  stepType: "email",
  config: { templateId: "tpl_welcome" },
});
await openmail.campaigns.activate(campaign.id);
await openmail.campaigns.pause(campaign.id);

// Segments
const segment = await openmail.segments.create({
  name: "Pro Users",
  conditions: [{ field: "attributes.plan", operator: "eq", value: "pro" }],
});
const { data: members } = await openmail.segments.members(segment.id);
const usage = await openmail.segments.usage(segment.id);

// Templates
const template = await openmail.templates.create({
  name: "Welcome Email",
  subject: "Welcome to Acme! 🎉",
  htmlContent: "<h1>Welcome!</h1><p>Thanks for signing up.</p>",
});

// Analytics
const stats = await openmail.analytics.overview();
// stats.contacts, stats.openRate (percentage, e.g. 24.3), stats.period
const broadcastStats = await openmail.analytics.broadcast("brd_abc123");

// Assets
const asset = await openmail.assets.uploadFromUrl({
  url: "https://example.com/logo.png",
  name: "Company Logo",
});
// Use asset.proxyUrl in email HTML: <img src="{proxyUrl}" />

// Merge properties without overwriting existing ones
await openmail.setUserProperties("alice@example.com", {
  lastLoginAt: new Date().toISOString(),
  featureFlags: { newDashboard: true },
});
```

### Express / Fastify example

```ts
import express from "express";
import { OpenMail } from "@openmail/sdk";

const openmail = new OpenMail({ apiKey: process.env.OPENMAIL_API_KEY! });
const app = express();
app.use(express.json());

app.post("/webhooks/stripe", async (req, res) => {
  const event = req.body;
  if (event.type === "invoice.paid") {
    const email = event.data.object.customer_email;
    await Promise.all([
      openmail.identify(email, { plan: "pro" }),
      openmail.track("invoice_paid", {
        amount: event.data.object.amount_paid / 100,
        currency: "usd",
      }, { userId: email }),
    ]);
  }
  res.json({ received: true });
});

// Flush on shutdown
process.on("SIGTERM", async () => {
  await openmail.flush();
  process.exit(0);
});
```

---

## Browser

Import from `@openmail/sdk/browser`:

```ts
import { OpenMailBrowser } from "@openmail/sdk/browser";

const openmail = new OpenMailBrowser({
  apiKey: "om_your_public_key",
  autoPageView: true,         // auto-track page views + SPA navigation changes
  persistence: "localStorage", // "localStorage" | "cookie" | "memory"
  cookieDomain: ".example.com", // for cross-subdomain tracking (optional)
  flushAt: 20,
  flushInterval: 5_000,
});
```

```ts
// On user login
await openmail.identify("alice@example.com", {
  firstName: "Alice",
  plan: "pro",
});

// Anonymous ID is auto-generated before identify() and linked on identify()
console.log(openmail.anonymousId); // "7f3a8b21-..."
console.log(openmail.userId);      // "alice@example.com" after identify()

// Track events — fire-and-forget, automatically batched + flushed
openmail.track("button_clicked", { button: "upgrade", page: "/pricing" });
openmail.track("form_submitted", { form: "contact" });

// Page views (manual — only needed if autoPageView: false)
openmail.page("Pricing", { path: "/pricing" });

// Group association
openmail.group("acme-corp", { name: "Acme Corp", plan: "enterprise" });

// Opt out / in (persist to localStorage/cookie)
openmail.opt_out_capturing(); // events silently dropped
openmail.opt_in_capturing();
console.log(openmail.isOptedOut); // false

// On logout — clears userId, generates new anonymous ID
openmail.reset();

// Clean up on unmount / HMR
await openmail.destroy();
```

### Cookie persistence (cross-subdomain)

```ts
const openmail = new OpenMailBrowser({
  apiKey: "om_...",
  persistence: "cookie",
  cookieDomain: ".example.com", // tracks users across app.example.com and www.example.com
  cookieExpiry: 365,            // days
});
```

---

## React

Import from `@openmail/sdk/react`:

```tsx
import {
  OpenMailProvider,
  useTrack,
  useIdentify,
  useAutoIdentify,
  usePage,
  useGroup,
  useOpenMail,
} from "@openmail/sdk/react";
```

### Setup — wrap your app root

```tsx
// app.tsx or main.tsx
import { OpenMailProvider } from "@openmail/sdk/react";

export default function App() {
  return (
    <OpenMailProvider
      apiKey={import.meta.env.VITE_OPENMAIL_KEY}
      autoPageView={true}
      persistence="localStorage"
    >
      <AuthSync />
      <Router />
    </OpenMailProvider>
  );
}
```

### Auto-identify on auth state

```tsx
// Automatically calls identify() when user logs in, reset() on logout
function AuthSync() {
  const { user } = useAuth(); // your auth hook
  useAutoIdentify(
    user?.email ?? null,         // null = reset (logout)
    { firstName: user?.firstName, plan: user?.plan }
  );
  return null;
}
```

### Track events from components

```tsx
function UpgradeButton({ plan }: { plan: string }) {
  const track = useTrack();

  return (
    <button
      onClick={async () => {
        await track("upgrade_clicked", { plan, page: "/pricing" });
        // proceed with upgrade
      }}
    >
      Upgrade to {plan}
    </button>
  );
}
```

### Group association (workspace/org)

```tsx
function WorkspaceProvider({ workspace }) {
  const group = useGroup();

  useEffect(() => {
    if (workspace) {
      group(workspace.id, {
        name: workspace.name,
        plan: workspace.plan,
        memberCount: workspace.memberCount,
      });
    }
  }, [workspace?.id]);

  return null;
}
```

### Direct SDK access

```tsx
function ExportButton() {
  const openmail = useOpenMail(); // full SDK access

  return (
    <button
      onClick={async () => {
        await openmail.track("export_started", { format: "csv" });
        const stats = await openmail.analytics.overview();
        console.log(`Open rate: ${stats.openRate}%`);
      }}
    >
      Export
    </button>
  );
}
```

### Provider props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `apiKey` | `string` | **required** | Workspace public API key |
| `apiUrl` | `string` | `https://api.openmail.win` | Custom API URL |
| `autoPageView` | `boolean` | `true` | Auto-track page views |
| `persistence` | `string` | `"localStorage"` | Storage backend |
| `cookieDomain` | `string` | — | Cookie domain for cross-subdomain |
| `flushAt` | `number` | `20` | Events per batch |
| `flushInterval` | `number` | `5000` | Max ms between flushes |
| `disabled` | `boolean` | `false` | Disable all tracking |
| `debug` | `boolean` | `false` | Enable verbose logging |

---

## Next.js

Import from `@openmail/sdk/nextjs`.

### App Router setup

```tsx
// components/openmail-provider.tsx
"use client";
import { OpenMailProvider } from "@openmail/sdk/nextjs";

export function TrackingProvider({ children }: { children: React.ReactNode }) {
  return (
    <OpenMailProvider
      apiKey={process.env.NEXT_PUBLIC_OPENMAIL_KEY!}
      autoPageView
    >
      {children}
    </OpenMailProvider>
  );
}
```

```tsx
// app/layout.tsx
import { TrackingProvider } from "@/components/openmail-provider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TrackingProvider>{children}</TrackingProvider>
      </body>
    </html>
  );
}
```

### Server-side tracking (route handlers, server actions)

```ts
import { serverTrack, serverIdentify, serverFlush } from "@openmail/sdk/nextjs";

// Route handler
export async function POST(req: Request) {
  const { email, plan } = await req.json();

  await serverIdentify(email, { plan });
  await serverTrack("plan_upgraded", { plan }, { userId: email });

  return Response.json({ ok: true });
}

// Server Action
"use server";
export async function upgradeAction(email: string, plan: string) {
  await serverTrack("upgrade_started", { plan }, { userId: email });
  // ... upgrade logic
}
```

### Per-request client (edge-safe)

```ts
import { createServerClient } from "@openmail/sdk/nextjs";
export const runtime = "edge";

export async function POST(req: Request) {
  const openmail = createServerClient(); // uses OPENMAIL_API_KEY
  await openmail.track("event", { key: "val" }, { userId: "user@example.com" });
  await openmail.flush(); // always flush before edge function exits
  return Response.json({ ok: true });
}
```

### Auth sync

```tsx
// components/auth-sync.tsx
"use client";
import { useAutoIdentify } from "@openmail/sdk/nextjs";
import { useSession } from "next-auth/react"; // or your auth lib

export function AuthSync() {
  const { data: session } = useSession();
  useAutoIdentify(
    session?.user?.email ?? null,
    { name: session?.user?.name }
  );
  return null;
}
```

### Environment variables

```bash
# .env.local
OPENMAIL_API_KEY=om_your_secret_key          # server-side only (never expose)
NEXT_PUBLIC_OPENMAIL_KEY=om_your_public_key  # browser-safe
OPENMAIL_API_URL=https://api.openmail.win    # optional: self-hosted URL
```

---

## Migrate from PostHog

Change the host URL. That's it — all PostHog SDK calls work as-is.

### PostHog Node SDK

```ts
import { PostHog } from "posthog-node";

// Before:
const posthog = new PostHog("phc_your_key", {
  host: "https://app.posthog.com",
});

// After — one line change:
const posthog = new PostHog("om_your_key", {
  host: "https://api.openmail.win/api/ingest",
});

// All these work without any other changes:
posthog.capture({ distinctId: "alice@example.com", event: "plan_upgraded", properties: { plan: "pro" } });
posthog.identify({ distinctId: "alice@example.com", properties: { name: "Alice", plan: "pro" } });
await posthog.shutdown();
```

### PostHog Python SDK

```python
from posthog import Posthog

# Before:
posthog = Posthog("phc_your_key", host="https://app.posthog.com")

# After:
posthog = Posthog("om_your_key", host="https://api.openmail.win/api/ingest")

posthog.capture("alice@example.com", "plan_upgraded", {"plan": "pro"})
```

> **Note:** `distinct_id` should be the user's email address. If you're using UUIDs, pass the email in `properties.$email` so OpenMail can link events to contacts.

---

## Migrate from Customer.io

### Customer.io Node SDK

```ts
const { TrackClient } = require("customerio-node");

// Before:
const cio = new TrackClient("site_id", "api_key");

// After — one URL change:
const cio = new TrackClient("workspace_id", "om_your_key", {
  url: "https://api.openmail.win/api/ingest/cio/v1",
});

// All these work:
cio.identify("alice@example.com", {
  email: "alice@example.com",
  first_name: "Alice",
  plan: "pro",
});

cio.track("alice@example.com", {
  name: "plan_upgraded",
  data: { from_plan: "starter", to_plan: "pro" },
});
```

### REST API (Basic Auth)

Customer.io uses Basic Auth: `Authorization: Basic base64(site_id:api_key)`.
Pass your OpenMail API key as the password:

```bash
# Identify
curl -X POST https://api.openmail.win/api/ingest/cio/v1/customers/alice@example.com \
  -u "workspace_id:om_your_key" \
  -H "Content-Type: application/json" \
  -d '{ "email": "alice@example.com", "first_name": "Alice", "plan": "pro" }'

# Track event
curl -X POST https://api.openmail.win/api/ingest/cio/v1/customers/alice@example.com/events \
  -u "workspace_id:om_your_key" \
  -H "Content-Type: application/json" \
  -d '{ "name": "plan_upgraded", "data": { "plan": "pro" } }'
```

---

## Migrate from Segment

`@openmail/sdk` uses the same method names as `@segment/analytics-node`:

```ts
// Before (Segment):
import { Analytics } from "@segment/analytics-node";
const analytics = new Analytics({ writeKey: "YOUR_WRITE_KEY" });
analytics.identify({ userId: "alice@example.com", traits: { plan: "pro" } });
analytics.track({ userId: "alice@example.com", event: "plan_upgraded", properties: { plan: "pro" } });
analytics.page({ userId: "alice@example.com", name: "Pricing" });

// After (OpenMail) — same methods, similar API:
import { OpenMail } from "@openmail/sdk";
const openmail = new OpenMail({ apiKey: "om_your_key" });
await openmail.identify("alice@example.com", { plan: "pro" });
await openmail.track("plan_upgraded", { plan: "pro" }, { userId: "alice@example.com" });
await openmail.page("Pricing", {}, { userId: "alice@example.com" });
```

Key difference: Segment uses per-call `userId`/`anonymousId` options; OpenMail remembers the user after `identify()`.

---

## Full API Reference

### `new OpenMail(config)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | Workspace API key (starts with `om_`) |
| `apiUrl` | `string` | `https://api.openmail.win` | API base URL (for self-hosted) |
| `flushAt` | `number` | `20` | Events to buffer before auto-flushing |
| `flushInterval` | `number` | `10000` | Max ms between automatic flushes |
| `maxRetries` | `number` | `3` | Retries on transient errors (500, 502, 503, 408, 429) |
| `timeout` | `number` | `10000` | Request timeout in ms |
| `disabled` | `boolean` | `false` | Disable all tracking (useful in tests) |
| `debug` | `boolean` | `false` | Log all API calls to console |

### Core methods

| Method | Description |
|--------|-------------|
| `identify(userId, traits?)` | Create/update a contact. `traits.email` or email-as-userId required. |
| `track(event, props?, opts?)` | Track an event. Fire-and-forget, batched internally. |
| `page(name?, props?, opts?)` | Track a page view (`$pageview` event). |
| `screen(name?, props?, opts?)` | Track a screen view (`$screen` event). |
| `group(groupId, traits?, opts?)` | Associate user with a group (`$group` event). |
| `alias(userId, previousId)` | Link two identities (`$alias` event). |
| `capture(event, props?)` | PostHog alias for `track()`. |
| `reset()` | Clear current user context (call on logout). |
| `opt_in_capturing()` | Re-enable tracking. |
| `opt_out_capturing()` | Disable tracking (events silently dropped). |
| `setUserProperties(email, props)` | Merge properties without overwriting existing ones. |
| `flush()` | Flush all buffered events. Call before `process.exit()`. |
| `shutdown()` | Flush + destroy timer. |
| `queuedEvents` | Number of events waiting to be flushed. |

### Sub-client namespaces

```ts
openmail.contacts    // .list() .create() .get() .update() .delete() .events() .sends()
openmail.broadcasts  // .list() .create() .get() .update() .send() .schedule() .testSend() .topLinks() .sends() .delete()
openmail.campaigns   // .list() .create() .get() .update() .activate() .pause() .archive() .delete() .addStep() .updateStep() .deleteStep() .listSteps() .getStep()
openmail.segments    // .list() .create() .get() .update() .delete() .members() .usage()
openmail.templates   // .list() .create() .get() .update() .delete()
openmail.analytics   // .overview() .broadcast(id)
openmail.assets      // .list() .get() .uploadFromUrl() .uploadBase64() .getUploadUrl() .delete()
```

---

## Error Handling

All methods throw `OpenMailError` on failure:

```ts
import { OpenMail, OpenMailError } from "@openmail/sdk";

const openmail = new OpenMail({ apiKey: "om_..." });

try {
  await openmail.contacts.get("con_nonexistent");
} catch (err) {
  if (err instanceof OpenMailError) {
    console.log(err.code);    // "NOT_FOUND" | "UNAUTHORIZED" | "VALIDATION_ERROR" | ...
    console.log(err.status);  // 404
    console.log(err.message); // "Not found"
    console.log(err.response); // raw API response body
  }
}
```

**Error codes:** `UNAUTHORIZED` · `NOT_FOUND` · `VALIDATION_ERROR` · `RATE_LIMITED` · `SERVER_ERROR` · `NETWORK_ERROR` · `TIMEOUT` · `DISABLED`

```ts
// Gracefully handle opt-out
openmail.disabled = true; // OR:
openmail.opt_out_capturing();
const result = await openmail.track("test");
// returns { id: "" } instead of throwing — no network call made
```

---

## Configuration for Tests

Disable the SDK in test environments to avoid accidental API calls:

```ts
// jest.config.ts / vitest.config.ts
process.env.OPENMAIL_DISABLED = "true";

// In your SDK initialization:
const openmail = new OpenMail({
  apiKey: process.env.OPENMAIL_API_KEY ?? "om_test",
  disabled: process.env.OPENMAIL_DISABLED === "true",
});
```

Or mock the SDK entirely:

```ts
// __mocks__/@openmail/sdk.ts
export const OpenMail = jest.fn(() => ({
  identify: jest.fn().mockResolvedValue({}),
  track: jest.fn().mockResolvedValue({ id: "evt_test" }),
  flush: jest.fn().mockResolvedValue(undefined),
}));
```

---

## Entry Points

| Import | Target | Key exports |
|--------|--------|-------------|
| `@openmail/sdk` | Node.js 18+ / Server | `OpenMail`, `createOpenMail`, `OpenMailError` |
| `@openmail/sdk/browser` | Browser (ES2020+) | `OpenMailBrowser`, `createOpenMailBrowser` |
| `@openmail/sdk/react` | React 17+ | `OpenMailProvider`, `useOpenMail`, `useTrack`, `useIdentify`, `useAutoIdentify`, `usePage`, `useGroup` |
| `@openmail/sdk/nextjs` | Next.js 13+ | All of the above + `serverTrack`, `serverIdentify`, `serverFlush`, `createServerClient`, `identifyAndTrack` |

Each entry point is tree-shakeable and ships both ESM (`.js`) and CJS (`.cjs`) builds with full TypeScript declarations.

---

## License

[Elastic License 2.0 (ELv2)](../LICENSE) — free to self-host, no SaaS reselling.

For commercial/managed service usage → [Enterprise License](mailto:kai@1flow.ai)
