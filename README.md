<div align="center">

# OpenMail

**The open-source Customer.io alternative built for the AI era**

Self-host your entire customer lifecycle email platform — with a full API, native SDK, native MCP server for AI agents, and no per-seat pricing.

[![License: ELv2](https://img.shields.io/badge/License-ELv2-blue.svg)](https://www.elastic.co/licensing/elastic-license)
[![GitHub Stars](https://img.shields.io/github/stars/ShadowWalker2014/openmail?style=social)](https://github.com/ShadowWalker2014/openmail/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Hono](https://img.shields.io/badge/Hono-4.7-orange?logo=hono)](https://hono.dev)
[![Railway](https://img.shields.io/badge/Deploy-Railway-purple?logo=railway)](https://railway.app)

[**Quick Start**](#quick-start) · [**SDK**](#sdk--event-tracking) · [**API Docs**](#api-reference) · [**MCP Server**](#mcp-server-for-ai-agents) · [**Enterprise**](#enterprise) · [**Contributing**](#contributing)

</div>

---

## Why OpenMail?

Customer.io costs **$1,000+/month** for growing teams, has a **limited API** that blocks automation, and **no support for AI agents**. OpenMail gives you everything — self-hosted, full API access, a native SDK, and a native [MCP server](https://modelcontextprotocol.io) so your AI agents can run email campaigns autonomously.

| Feature | OpenMail | Customer.io |
|---------|----------|-------------|
| Self-hosted | ✅ | ❌ |
| Full REST API | ✅ Everything | ⚠️ Limited |
| **Native SDK** | ✅ Node / Browser / React / Next.js | ⚠️ Basic only |
| **MCP Server for AI Agents** | ✅ Native | ❌ |
| PostHog/Segment compatible | ✅ Drop-in | ❌ |
| Multi-workspace | ✅ | ✅ |
| Event-triggered campaigns | ✅ | ✅ |
| Broadcasts | ✅ | ✅ |
| Contact segments | ✅ | ✅ |
| Email templates | ✅ Visual + HTML | ✅ |
| Open/click tracking | ✅ | ✅ |
| Per-seat pricing | ❌ Never | 💸 Yes |
| Vendor lock-in | ❌ Never | 💸 Yes |
| Price | **Free** / [Enterprise](mailto:kai@1flow.ai) | $1k–$10k+/mo |

---

## Features

- **📧 Broadcasts** — Send one-off email blasts to any segment, with scheduling support
- **⚡ Campaigns** — Event-triggered automation sequences with multi-step flows
- **👥 Contacts & Segments** — Flexible contact attributes + rule-based dynamic segments
- **📐 Email Templates** — HTML editor + visual builder, fully reusable
- **📊 Analytics** — Open rates, click rates, unsubscribes, broadcast performance
- **🔑 API Keys** — Workspace-scoped API keys for programmatic access
- **📦 SDK** — TypeScript SDK for Node.js, Browser, React, and Next.js
- **🤖 MCP Server** — Native HTTP MCP server: let any AI agent create and run campaigns
- **🔔 Event Tracking** — REST API + SDK compatible with PostHog and Customer.io
- **🏢 Multi-workspace** — Team workspaces with role-based access (owner/admin/member)
- **📬 Unsubscribe** — Automatic unsubscribe handling, CAN-SPAM compliant
- **🎯 Click Tracking** — Full click-through tracking with redirect proxy

---

## Architecture

OpenMail is a monorepo of 5 services + 1 SDK package, each independently deployable:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────────┐
│   web/      │    │   api/      │    │    mcp/         │
│  React Vite │───▶│  Hono REST  │◀───│  MCP HTTP       │
│  Dashboard  │    │  API + Auth │    │  AI Agent API   │
└─────────────┘    └──────┬──────┘    └─────────────────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
       ┌──────▼─────┐  ┌──▼──────┐  ┌▼──────────┐
       │  worker/   │  │  Postgres│  │ tracker/  │
       │  BullMQ    │  │  + Redis │  │ Pixel/    │
       │  Workers   │  └──────────┘  │ Clicks    │
       └────────────┘                └───────────┘

         sdk/  ←── npm package (@openmail/sdk)
```

| Service | Tech | Purpose |
|---------|------|---------|
| `web/` | React + Vite + TanStack | Dashboard UI |
| `api/` | Hono + Better Auth + Drizzle | REST API + auth |
| `mcp/` | Hono + MCP SDK | AI agent interface |
| `worker/` | BullMQ + Resend | Email sending + events |
| `tracker/` | Hono | Open/click pixel tracking |
| `sdk/` | TypeScript | npm package for event tracking |

---

## Quick Start

### Option 1: Docker Compose (recommended)

```bash
git clone https://github.com/ShadowWalker2014/openmail.git
cd openmail
cp .env.example .env
# Edit .env — add your Resend API key and a secret
docker compose up -d
```

Open `http://localhost:5173` — sign up, create a workspace, and start sending.

### Option 2: Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

Each service deploys as a separate Railway service from the same repo. Set the **Root Directory** to `/` and the **Dockerfile Path** to the service's Dockerfile (e.g., `api/Dockerfile`).

See the [Railway Deployment Guide](https://docs.openmail.win/self-hosting/railway) for full instructions.

### Option 3: Manual Setup

**Prerequisites**: [Bun](https://bun.sh), PostgreSQL, Redis

```bash
# Clone and install
git clone https://github.com/ShadowWalker2014/openmail.git
cd openmail
bun install

# Configure each service
cp api/.env.example api/.env.local
cp worker/.env.example worker/.env.local
cp tracker/.env.example tracker/.env.local
# Edit each file with your credentials

# Run database migrations
bun db:generate
bun db:migrate

# Start all services
bun dev:api      # API on :3001
bun dev:mcp      # MCP on :3002
bun dev:tracker  # Tracker on :3003
bun dev:worker   # Background workers
bun dev:web      # Dashboard on :5173
```

---

## SDK — Event Tracking

Track user events from any language or framework. The official `@openmail/sdk` package is compatible with **Segment Analytics 2.0** and **PostHog** interfaces, making migration a one-line change.

### Installation

```bash
# npm
npm install @openmail/sdk

# bun
bun add @openmail/sdk

# pnpm
pnpm add @openmail/sdk

# yarn
yarn add @openmail/sdk
```

### Node.js / Server-side

```ts
import { OpenMail } from "@openmail/sdk";

const openmail = new OpenMail({
  apiKey: process.env.OPENMAIL_API_KEY!, // om_your_key from Settings → API Keys
});

// Identify a user — creates or updates a contact
await openmail.identify("alice@example.com", {
  firstName: "Alice",
  lastName: "Smith",
  plan: "pro",
  company: "Acme Corp",
});

// Track an event — triggers matching campaign automations
await openmail.track("plan_upgraded", {
  from_plan: "starter",
  to_plan: "pro",
  mrr: 99,
}, { userId: "alice@example.com" });

// Access the full REST API
const broadcasts = await openmail.broadcasts.list();
const segment = await openmail.segments.create({
  name: "Pro Users",
  conditions: [{ field: "attributes.plan", operator: "eq", value: "pro" }],
});

// Flush buffered events before process exit
await openmail.flush();
```

### Browser

```ts
import { OpenMailBrowser } from "@openmail/sdk/browser";

const openmail = new OpenMailBrowser({
  apiKey: "om_your_public_key",
  autoPageView: true,       // auto-tracks page views and SPA navigations
  persistence: "localStorage",
});

// On user login
await openmail.identify("alice@example.com", { plan: "pro" });

// Track events (fire-and-forget, automatically batched)
openmail.track("upgrade_clicked", { plan: "pro", page: "/pricing" });

// On logout
openmail.reset();
```

### React

```tsx
import { OpenMailProvider, useTrack, useAutoIdentify } from "@openmail/sdk/react";
import { useUser } from "./hooks";

// 1. Wrap your app root
function App() {
  return (
    <OpenMailProvider
      apiKey={import.meta.env.VITE_OPENMAIL_KEY}
      autoPageView
    >
      <AuthSync />
      <Router />
    </OpenMailProvider>
  );
}

// 2. Auto-identify on auth state changes
function AuthSync() {
  const { user } = useUser();
  useAutoIdentify(user?.email ?? null, {
    firstName: user?.firstName,
    plan: user?.plan,
  });
  return null;
}

// 3. Track events from any component
function UpgradeButton() {
  const track = useTrack();
  return (
    <button onClick={() => track("upgrade_clicked", { plan: "pro" })}>
      Upgrade to Pro
    </button>
  );
}
```

### Next.js

```tsx
// app/layout.tsx — client wrapper for browser tracking
"use client";
import { OpenMailProvider } from "@openmail/sdk/nextjs";

export function TrackingProvider({ children }: { children: React.ReactNode }) {
  return (
    <OpenMailProvider apiKey={process.env.NEXT_PUBLIC_OPENMAIL_KEY!} autoPageView>
      {children}
    </OpenMailProvider>
  );
}
```

```ts
// Server-side: route handlers, server actions, middleware
import { serverTrack, serverIdentify } from "@openmail/sdk/nextjs";

// In a route handler (uses OPENMAIL_API_KEY env var automatically)
export async function POST(req: Request) {
  const { email, plan } = await req.json();
  await serverIdentify(email, { plan });
  await serverTrack("plan_upgraded", { plan }, { userId: email });
  return Response.json({ ok: true });
}
```

```bash
# .env.local
OPENMAIL_API_KEY=om_your_secret_key          # server-side only
NEXT_PUBLIC_OPENMAIL_KEY=om_your_public_key  # browser (public)
```

### Migrate from PostHog

```ts
// Before (PostHog)
const posthog = new PostHog("phc_your_key", {
  host: "https://app.posthog.com",
});

// After (OpenMail) — just change the host URL, no other code changes
const posthog = new PostHog("om_your_key", {
  host: "https://api.openmail.win/api/ingest",
});
```

### Migrate from Customer.io

```ts
// Before (Customer.io)
const cio = new TrackClient("site_id", "api_key");

// After (OpenMail) — just change the URL
const cio = new TrackClient("workspace_id", "om_your_key", {
  url: "https://api.openmail.win/api/ingest/cio/v1",
});
```

### Migrate from Segment

The `@openmail/sdk` API is a drop-in replacement for `@segment/analytics-node`:

```ts
// Before (Segment)
analytics.identify({ userId: "alice@example.com", traits: { plan: "pro" } });
analytics.track({ userId: "alice@example.com", event: "plan_upgraded", properties: { plan: "pro" } });

// After (OpenMail) — same method names, slightly different signature
openmail.identify("alice@example.com", { plan: "pro" });
openmail.track("plan_upgraded", { plan: "pro" }, { userId: "alice@example.com" });
```

### Available Packages

| Import | Environment | Description |
|--------|-------------|-------------|
| `@openmail/sdk` | Node.js / Server | Full API + event tracking, Segment/PostHog compatible |
| `@openmail/sdk/browser` | Browser | Auto page tracking, anonymous IDs, batching |
| `@openmail/sdk/react` | React 17+ | Provider + `useTrack`, `useIdentify`, `useAutoIdentify` hooks |
| `@openmail/sdk/nextjs` | Next.js 13+ | `serverTrack`, `serverIdentify`, App/Pages Router support |

📖 **[Full SDK Documentation →](https://docs.openmail.win/sdk/overview)**

---

## MCP Server for AI Agents

OpenMail exposes a native **Model Context Protocol (MCP) HTTP server** at `POST /mcp`. Any AI agent (Claude, GPT, Cursor, etc.) can create and manage entire email campaigns autonomously.

### Connect your AI agent

```json
{
  "mcpServers": {
    "openmail": {
      "url": "https://mcp.openmail.win/mcp",
      "headers": {
        "Authorization": "Bearer om_your_workspace_api_key"
      }
    }
  }
}
```

### Available MCP Tools (29 total)

| Category | Tools |
|----------|-------|
| **Contacts** | `list_contacts`, `create_contact`, `update_contact`, `delete_contact`, `track_event` |
| **Broadcasts** | `list_broadcasts`, `get_broadcast`, `create_broadcast`, `update_broadcast`, `schedule_broadcast`, `send_broadcast`, `delete_broadcast` |
| **Campaigns** | `list_campaigns`, `create_campaign`, `update_campaign`, `pause_campaign` |
| **Segments** | `list_segments`, `create_segment` |
| **Templates** | `list_templates`, `create_template`, `update_template`, `delete_template` |
| **Analytics** | `get_analytics`, `get_broadcast_analytics` |
| **Assets** | `list_assets`, `get_asset`, `upload_asset_from_url`, `upload_asset_base64`, `delete_asset` |

### Example: Ask Claude to run a campaign

```
You: "Create a 'welcome' campaign for new signups that sends a welcome email immediately,
then a tips email 3 days later, targeting the 'new-users' segment"

Claude: [uses OpenMail MCP tools to create campaign, templates, and activate automatically]
```

---

## API Reference

All API endpoints are available at `/api/v1/` (API key auth) or `/api/session/ws/:workspaceId/` (session auth).

### Authentication

```bash
# Get your API key from the dashboard → Settings → API Keys
curl -H "Authorization: Bearer om_your_api_key" \
  https://your-api.railway.app/api/v1/contacts
```

### Core Endpoints

```bash
# Contacts
GET    /api/v1/contacts              # List with pagination + search
POST   /api/v1/contacts              # Create or upsert by email
GET    /api/v1/contacts/:id          # Get contact
PATCH  /api/v1/contacts/:id          # Update attributes
DELETE /api/v1/contacts/:id          # Hard delete
GET    /api/v1/contacts/:id/events   # Contact event history
GET    /api/v1/contacts/:id/sends    # Contact email send history

# Events
POST   /api/v1/events/track          # { email, name, properties, occurredAt? }
GET    /api/v1/events                # List workspace events (paginated)

# Event Ingestion (PostHog/Customer.io compatible)
POST   /api/ingest/capture           # PostHog single event format
POST   /api/ingest/batch             # PostHog batch format (up to 100/call)
POST   /api/ingest/identify          # PostHog/Segment identify
POST   /api/ingest/cio/v1/customers/:id         # Customer.io identify
POST   /api/ingest/cio/v1/customers/:id/events  # Customer.io track

# Broadcasts
GET    /api/v1/broadcasts            # List all
POST   /api/v1/broadcasts            # Create draft
PATCH  /api/v1/broadcasts/:id        # Update draft (incl. schedule)
POST   /api/v1/broadcasts/:id/send   # Send immediately
POST   /api/v1/broadcasts/:id/test-send  # Send test email

# Campaigns
GET    /api/v1/campaigns             # List all
POST   /api/v1/campaigns             # Create
PATCH  /api/v1/campaigns/:id         # Update/activate/pause
POST   /api/v1/campaigns/:id/steps   # Add campaign step

# Segments
GET    /api/v1/segments              # List
POST   /api/v1/segments              # Create with conditions
GET    /api/v1/segments/:id/people   # List segment members

# Analytics
GET    /api/v1/analytics/overview    # 30-day workspace stats
GET    /api/v1/analytics/broadcasts/:id  # Broadcast performance
```

### Event Tracking Example

```bash
curl -X POST https://your-api.railway.app/api/v1/events/track \
  -H "Authorization: Bearer om_..." \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "name": "user_upgraded",
    "properties": { "plan": "pro", "mrr": 99 }
  }'
```

This automatically triggers any active campaign with `triggerType: "event"` and `eventName: "user_upgraded"`.

📖 **[Full API Documentation →](https://docs.openmail.win/api/authentication)**

---

## Configuration

### Required Environment Variables

**`api/`**
| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `BETTER_AUTH_SECRET` | ✅ | 32+ char random secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | ✅ | Public URL of the API service |
| `WEB_URL` | ✅ | Public URL of the web dashboard |
| `RESEND_API_KEY` | ✅ | Resend API key — see [Email Setup](#email-setup) below |
| `PLATFORM_FROM_EMAIL` | ✅ | Sender address for system emails (must be verified in Resend) |
| `PLATFORM_FROM_NAME` | — | Sender display name (default: `OpenMail`) |
| `DEFAULT_FROM_EMAIL` | — | Fallback sender for workspace campaigns without a custom key |
| `DEFAULT_FROM_NAME` | — | Fallback sender name (default: `OpenMail`) |
| `TRACKER_URL` | — | Public URL of tracker service (enables open/click tracking) |

**`worker/`**
| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Same PostgreSQL instance |
| `REDIS_URL` | ✅ | Same Redis instance |
| `RESEND_API_KEY` | ✅ | Same Resend API key |
| `TRACKER_URL` | ✅ | Public URL of tracker service |
| `DEFAULT_FROM_EMAIL` | — | Fallback sender for workspace campaign emails |

---

## Email Setup

OpenMail sends two categories of emails:

| Category | Examples | Controlled by |
|----------|----------|---------------|
| **Platform emails** | Password resets, workspace invites | `PLATFORM_FROM_EMAIL` |
| **Campaign emails** | Broadcasts, automation sequences | Per-workspace Resend key (Settings → Email Sending) |

### 1. Create a Resend account

1. Sign up at [resend.com](https://resend.com)
2. Go to **API Keys** → **Create API Key** (full access)
3. Set `RESEND_API_KEY` in your `api/` environment

### 2. Add and verify a sending domain

> ⚠️ You **cannot** send from `@gmail.com`, `@outlook.com`, or any domain you don't own.
> You must add a domain you control.

1. In the Resend dashboard → **Domains** → **Add Domain**
2. Enter your domain (e.g. `mail.yourdomain.com` or `yourdomain.com`)
3. Add the DNS records Resend provides (SPF, DKIM, DMARC) to your DNS registrar
4. Click **Verify** — usually takes 1–5 minutes

### 3. Configure your environment

```bash
# api/.env.local
RESEND_API_KEY=re_your_key_here
PLATFORM_FROM_EMAIL=noreply@yourdomain.com
PLATFORM_FROM_NAME=YourApp
DEFAULT_FROM_EMAIL=noreply@yourdomain.com
DEFAULT_FROM_NAME=YourApp
```

### 4. (Optional) Per-workspace sending

Each workspace can configure its **own** Resend API key and sender address in **Settings → Email Sending**. This is useful for multi-tenant deployments where different teams send from different domains.

If a workspace hasn't configured its own key, it falls back to the platform's `RESEND_API_KEY` and `DEFAULT_FROM_EMAIL`.

---

## Roadmap

- [ ] Visual drag-and-drop email builder (Unlayer integration)
- [ ] Webhook ingestion (receive events from Stripe, Segment, etc.)
- [ ] Contact import via CSV
- [ ] Resend webhook → bounce/complaint handling
- [ ] A/B testing for broadcasts
- [ ] SendGrid / AWS SES / Postmark provider support
- [ ] SAML/SSO for enterprise
- [ ] Audit logs

> Want to influence the roadmap? [Open a discussion](https://github.com/ShadowWalker2014/openmail/discussions) or [vote on issues](https://github.com/ShadowWalker2014/openmail/issues).

---

## Contributing

We'd love your help making OpenMail better. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Good first issues**: look for [`good first issue`](https://github.com/ShadowWalker2014/openmail/labels/good%20first%20issue) labels.

```bash
# Fork, clone, install
git clone https://github.com/YOUR_USERNAME/openmail.git
cd openmail && bun install

# Create a branch
git checkout -b feat/your-feature

# Make changes, then submit a PR
```

---

## Enterprise

OpenMail is **free for self-hosting** under the [Elastic License 2.0](#license).

For enterprise deployments needing:
- **Managed hosting** with SLA guarantees
- **Enterprise SSO** (SAML, OKTA, Azure AD)
- **Priority support** and dedicated onboarding
- **Custom integrations** and professional services
- **Air-gapped / on-premise** deployment

→ **Contact us at [kai@1flow.ai](mailto:kai@1flow.ai)**

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19 + Vite + TanStack Router + TanStack Query |
| UI | Tailwind CSS + shadcn/ui components |
| Backend | [Hono](https://hono.dev) (ultra-fast TypeScript HTTP) |
| Auth | [Better Auth](https://better-auth.com) |
| Database | PostgreSQL + [Drizzle ORM](https://orm.drizzle.team) |
| Queue | [BullMQ](https://bullmq.io) + Redis |
| Email | [Resend](https://resend.com) |
| SDK | TypeScript (ESM + CJS, tree-shakeable) |
| MCP | [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) |
| Deploy | [Railway](https://railway.app) |

---

## License

OpenMail is licensed under the **[Elastic License 2.0 (ELv2)](LICENSE)**.

- ✅ Free to use, self-host, and modify
- ✅ Free for internal business use
- ❌ Cannot offer OpenMail as a **hosted/managed service** to third parties
- ❌ Cannot remove or bypass license protections

For commercial/managed service usage → [Enterprise License](mailto:kai@1flow.ai)

---

<div align="center">

Made with ❤️ by the [OpenMail contributors](https://github.com/ShadowWalker2014/openmail/graphs/contributors)

**[⭐ Star us on GitHub](https://github.com/ShadowWalker2014/openmail)** — it helps more developers find OpenMail!

</div>
