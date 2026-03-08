<div align="center">

# OpenMail

**The open-source Customer.io alternative built for the AI era**

Self-host your entire customer lifecycle email platform — with a full API, native MCP server for AI agents, and no per-seat pricing.

[![License: ELv2](https://img.shields.io/badge/License-ELv2-blue.svg)](https://www.elastic.co/licensing/elastic-license)
[![GitHub Stars](https://img.shields.io/github/stars/ShadowWalker2014/openmail?style=social)](https://github.com/ShadowWalker2014/openmail/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Hono](https://img.shields.io/badge/Hono-4.7-orange?logo=hono)](https://hono.dev)
[![Railway](https://img.shields.io/badge/Deploy-Railway-purple?logo=railway)](https://railway.app)

[**Quick Start**](#quick-start) · [**API Docs**](#api-reference) · [**MCP Server**](#mcp-server-for-ai-agents) · [**Enterprise**](#enterprise) · [**Contributing**](#contributing)

</div>

---

## Why OpenMail?

Customer.io costs **$1,000+/month** for growing teams, has a **limited API** that blocks automation, and **no support for AI agents**. OpenMail gives you everything — self-hosted, full API access, and a native [MCP server](https://modelcontextprotocol.io) so your AI agents can run email campaigns autonomously.

| Feature | OpenMail | Customer.io |
|---------|----------|-------------|
| Self-hosted | ✅ | ❌ |
| Full REST API | ✅ Everything | ⚠️ Limited |
| **MCP Server for AI Agents** | ✅ Native | ❌ |
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
- **🤖 MCP Server** — Native HTTP MCP server: let any AI agent create and run campaigns
- **🔔 Event Tracking** — REST API + SDK for tracking customer events
- **🏢 Multi-workspace** — Team workspaces with role-based access (owner/admin/member)
- **📬 Unsubscribe** — Automatic unsubscribe handling, CAN-SPAM compliant
- **🎯 Click Tracking** — Full click-through tracking with redirect proxy

---

## Architecture

OpenMail is a monorepo of 5 services, each deployable independently:

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
```

| Service | Tech | Purpose |
|---------|------|---------|
| `web/` | React + Vite + TanStack | Dashboard UI |
| `api/` | Hono + Better Auth + Drizzle | REST API + auth |
| `mcp/` | Hono + MCP SDK | AI agent interface |
| `worker/` | BullMQ + Resend | Email sending + events |
| `tracker/` | Hono | Open/click pixel tracking |

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

Open [http://localhost:5173](http://localhost:5173) — sign up, create a workspace, and start sending.

### Option 2: Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

Each service deploys as a separate Railway service from the same repo. Set the **Root Directory** to `/` and the **Dockerfile Path** to the service's Dockerfile (e.g., `api/Dockerfile`).

See [Railway Deployment Guide](docs/railway-deployment.md) for full instructions.

### Option 3: Manual Setup

**Prerequisites**: Bun, PostgreSQL, Redis

```bash
# Install dependencies
bun install

# Set up environment (copy and edit each service's .env.example)
cp api/.env.example api/.env.local
cp worker/.env.example worker/.env.local
cp tracker/.env.example tracker/.env.local

# Run database migrations
bun db:generate
bun db:migrate

# Start all services in development
bun dev:api      # API on :3001
bun dev:mcp      # MCP on :3002
bun dev:tracker  # Tracker on :3003
bun dev:worker   # Background workers
bun dev:web      # Dashboard on :5173
```

---

## MCP Server for AI Agents

OpenMail exposes a native **Model Context Protocol (MCP) HTTP server** at `POST /mcp`. Any AI agent (Claude, GPT, Cursor, etc.) can create and manage entire email campaigns autonomously.

### Connect your AI agent

```json
{
  "mcpServers": {
    "openmail": {
      "url": "https://your-mcp.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer om_your_workspace_api_key"
      }
    }
  }
}
```

### Available MCP Tools (17 total)

| Category | Tools |
|----------|-------|
| **Contacts** | `list_contacts`, `create_contact`, `update_contact`, `delete_contact`, `track_event` |
| **Broadcasts** | `list_broadcasts`, `create_broadcast`, `send_broadcast` |
| **Campaigns** | `list_campaigns`, `create_campaign`, `update_campaign`, `pause_campaign` |
| **Segments** | `list_segments`, `create_segment` |
| **Templates** | `list_templates`, `create_template`, `update_template` |
| **Analytics** | `get_analytics`, `get_broadcast_analytics` |

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
PATCH  /api/v1/contacts/:id          # Update attributes
DELETE /api/v1/contacts/:id          # Hard delete

# Track Events
POST   /api/v1/events/track          # { email, name, properties }

# Broadcasts
GET    /api/v1/broadcasts            # List all
POST   /api/v1/broadcasts            # Create draft
POST   /api/v1/broadcasts/:id/send   # Send immediately

# Campaigns
GET    /api/v1/campaigns             # List all
POST   /api/v1/campaigns             # Create
PATCH  /api/v1/campaigns/:id         # Update/activate/pause

# Segments
GET    /api/v1/segments              # List
POST   /api/v1/segments              # Create with conditions

# Analytics
GET    /api/v1/analytics/overview    # 30-day overview stats
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

---

## Configuration

### Required Environment Variables

**`api/`**
| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `BETTER_AUTH_SECRET` | 32+ char random secret |
| `BETTER_AUTH_URL` | Public URL of the API service |
| `RESEND_API_KEY` | Default Resend API key (platform-level) |

**`worker/`**
| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Same PostgreSQL instance |
| `REDIS_URL` | Same Redis instance |
| `RESEND_API_KEY` | Default Resend API key |
| `TRACKER_URL` | Public URL of tracker service |

Each workspace can also configure its **own Resend API key** in Settings → Email Sending.

---

## Roadmap

- [ ] Visual drag-and-drop email builder (Unlayer integration)
- [ ] Webhook ingestion (receive events from Stripe, Segment, etc.)
- [ ] Contact import via CSV
- [ ] Resend webhook → bounce/complaint handling
- [ ] Campaign step delay execution (wait nodes)
- [ ] A/B testing for broadcasts
- [ ] JavaScript SDK for event tracking
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
