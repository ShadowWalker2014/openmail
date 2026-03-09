# @openmail/sdk

> Official SDK for [OpenMail](https://openmail.win) — track events, identify users, and run email campaigns. Compatible with [Segment](https://segment.com) and [PostHog](https://posthog.com) interfaces.

[![npm](https://img.shields.io/npm/v/@openmail/sdk)](https://www.npmjs.com/package/@openmail/sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License: ELv2](https://img.shields.io/badge/License-ELv2-blue.svg)](https://www.elastic.co/licensing/elastic-license)

## Installation

```bash
npm install @openmail/sdk
# or
bun add @openmail/sdk
# or
pnpm add @openmail/sdk
```

## Quick Start

### Node.js / Server-side

```ts
import { OpenMail } from "@openmail/sdk";

const openmail = new OpenMail({
  apiKey: "om_your_workspace_api_key",
  // apiUrl: "https://api.openmail.win", // default
});

// Identify a user (creates/updates contact)
await openmail.identify("alice@example.com", {
  firstName: "Alice",
  lastName: "Smith",
  plan: "pro",
  company: "Acme Corp",
});

// Track an event
await openmail.track("plan_upgraded", {
  from_plan: "starter",
  to_plan: "pro",
  mrr: 99,
}, { userId: "alice@example.com" });

// Flush before process exit
await openmail.flush();
```

### Browser

```ts
import { OpenMailBrowser } from "@openmail/sdk/browser";

const openmail = new OpenMailBrowser({
  apiKey: "om_your_workspace_api_key",
  autoPageView: true, // auto-track page views
});

// On user login
await openmail.identify("alice@example.com", { plan: "pro" });

// Track events
openmail.track("button_clicked", { button: "upgrade" });

// On logout
openmail.reset();
```

### React

```tsx
import { OpenMailProvider, useTrack, useIdentify, useAutoIdentify } from "@openmail/sdk/react";

// Wrap your app root
function Root() {
  return (
    <OpenMailProvider apiKey="om_..." autoPageView>
      <App />
    </OpenMailProvider>
  );
}

// In any component
function UpgradeButton() {
  const track = useTrack();
  return (
    <button onClick={() => track("upgrade_clicked", { plan: "pro" })}>
      Upgrade
    </button>
  );
}

// Auto-identify after auth
function AuthHandler({ user }) {
  useAutoIdentify(
    user?.email ?? null,
    { firstName: user?.name, plan: user?.plan }
  );
  return null;
}
```

### Next.js

```ts
// app/layout.tsx (client component)
import { OpenMailProvider } from "@openmail/sdk/nextjs";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <OpenMailProvider apiKey={process.env.NEXT_PUBLIC_OPENMAIL_KEY!}>
          {children}
        </OpenMailProvider>
      </body>
    </html>
  );
}
```

```ts
// In route handlers / server actions
import { serverTrack, serverIdentify } from "@openmail/sdk/nextjs";

// Track server-side (uses OPENMAIL_API_KEY env var)
await serverTrack("invoice_paid", { amount: 99 }, { userId: "alice@example.com" });
await serverIdentify("alice@example.com", { plan: "pro" });
```

---

## Segment Compatibility

Drop-in compatible with [Segment Analytics 2.0](https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/):

```ts
// Segment → OpenMail migration
// Before:
analytics.identify("alice@example.com", { plan: "pro" });
analytics.track("page_viewed", { path: "/pricing" });
analytics.group("acme-corp", { name: "Acme" });
analytics.reset();

// After (same interface):
openmail.identify("alice@example.com", { plan: "pro" });
openmail.track("page_viewed", { path: "/pricing" }, { userId: "alice@example.com" });
openmail.group("acme-corp", { name: "Acme" }, { userId: "alice@example.com" });
openmail.reset();
```

## PostHog Compatibility

Compatible with [PostHog Node](https://posthog.com/docs/libraries/node):

```ts
// PostHog → OpenMail migration
// Before:
posthog.capture({ distinctId: "alice@example.com", event: "plan_upgraded" });
posthog.identify({ distinctId: "alice@example.com", properties: { plan: "pro" } });

// After:
openmail.capture("plan_upgraded", { plan: "pro" }); // after identify()
openmail.identify("alice@example.com", { plan: "pro" });
openmail.opt_in_capturing();
openmail.opt_out_capturing();
```

---

## Full API Reference

### `new OpenMail(config)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | Workspace API key (starts with `om_`) |
| `apiUrl` | `string` | `https://api.openmail.win` | Base URL of your OpenMail API |
| `flushAt` | `number` | `20` | Events to buffer before flushing |
| `flushInterval` | `number` | `10000` | Max ms between flushes |
| `maxRetries` | `number` | `3` | Retries on transient errors |
| `timeout` | `number` | `10000` | Request timeout in ms |
| `disabled` | `boolean` | `false` | Disable all tracking (useful in tests) |
| `debug` | `boolean` | `false` | Enable verbose logging |

### Core Methods (Segment/PostHog compatible)

| Method | Description |
|--------|-------------|
| `identify(userId, traits?)` | Create/update a contact. Returns `Contact`. |
| `track(event, props?, opts?)` | Track an event. Returns `{ id }`. |
| `page(name?, props?, opts?)` | Track a page view (`$pageview` event). |
| `screen(name?, props?, opts?)` | Track a screen view (`$screen` event). |
| `group(groupId, traits?, opts?)` | Associate user with a group (`$group` event). |
| `alias(userId, previousId)` | Alias two identities (`$alias` event). |
| `capture(event, props?)` | PostHog alias for `track()`. |
| `reset()` | Clear current user context (call on logout). |
| `opt_in_capturing()` | Enable tracking. |
| `opt_out_capturing()` | Disable tracking (events silently dropped). |
| `flush()` | Flush buffered events. |
| `shutdown()` | Flush and destroy (call before process exit). |

### Sub-API Namespaces

```ts
openmail.contacts    // CRUD + events + sends
openmail.broadcasts  // CRUD + send + schedule + test-send + top-links
openmail.campaigns   // CRUD + steps CRUD + activate/pause/archive
openmail.segments    // CRUD + members + usage
openmail.templates   // CRUD
openmail.analytics   // overview + broadcast stats
openmail.assets      // upload + list + delete
```

---

## Environment Variables

For Next.js server-side usage, set in `.env.local`:

```bash
OPENMAIL_API_KEY=om_your_secret_api_key     # server-side only
NEXT_PUBLIC_OPENMAIL_KEY=om_your_public_key # client-side (browser)
OPENMAIL_API_URL=https://api.openmail.win   # optional custom URL
```

---

## Error Handling

All methods throw `OpenMailError` on failure:

```ts
import { OpenMailError } from "@openmail/sdk";

try {
  await openmail.contacts.get("con_missing");
} catch (err) {
  if (err instanceof OpenMailError) {
    console.log(err.code);    // "NOT_FOUND"
    console.log(err.status);  // 404
    console.log(err.message); // "Not found"
  }
}
```

**Error codes:** `UNAUTHORIZED` · `NOT_FOUND` · `VALIDATION_ERROR` · `RATE_LIMITED` · `SERVER_ERROR` · `NETWORK_ERROR` · `TIMEOUT` · `DISABLED`

---

## License

[Elastic License 2.0 (ELv2)](../LICENSE) — free to self-host, no SaaS reselling.
