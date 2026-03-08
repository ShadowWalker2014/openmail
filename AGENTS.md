# AGENTS.md — OpenMail Project Memory

> **RULE**: When user says "remember this", update this file immediately with the new information.

## Project Overview
**OpenMail** — Open-source alternative to Customer.io. PLG customer lifecycle email marketing platform with full API + native MCP server for AI agent automation.

## Monorepo Structure
```
openmail/
├── packages/shared/     # Drizzle schema, shared types, utils (bun workspace)
├── web/                 # React + Vite dashboard (Railway service)
├── api/                 # Hono REST API — auth, business logic (Railway service)
├── mcp/                 # Hono MCP HTTP server — AI agent interface (Railway service)
├── worker/              # BullMQ workers — email sending, events (Railway service)
├── tracker/             # Hono — pixel opens + click tracking (Railway service)
└── .todo/[feat]/        # PRD.md + TODO.md per feature
```

## Tech Stack
| Layer | Choice |
|-------|--------|
| Frontend | React + Vite + TanStack Router + TanStack Query + shadcn/ui + Tailwind |
| Backend | Hono (api, mcp, tracker) |
| Auth | Better Auth (workspace/team support) |
| Database | Postgres (Railway) + Drizzle ORM |
| Queue | Redis (Railway) + BullMQ |
| Email | Resend |
| MCP | @modelcontextprotocol/sdk (HTTP transport) |
| Package mgr | Bun workspaces |
| Deploy | Railway (each subfolder = separate service) |

## Multi-Tenancy Model
- **Workspace** = billing unit (each customer account = 1 workspace)
- Users can belong to multiple workspaces (with roles: owner/admin/member)
- All data (contacts, campaigns, events, etc.) is scoped to workspace_id
- Each workspace configures its own Resend API key

## Core Domain Entities
- `workspaces` + `workspace_members` + `workspace_invites`
- `users` (auth, cross-workspace)
- `contacts` + `contact_attributes` (flexible KV for custom traits)
- `segments` + `segment_conditions` (rule-based dynamic segments)
- `events` (customer activity — event_name, contact_id, properties JSONB)
- `campaigns` (automation flows) + `campaign_steps` (trigger + actions)
- `broadcasts` (one-off email blasts)
- `email_templates` (HTML + visual builder output)
- `email_sends` (audit log) + `email_events` (opens, clicks, bounces — from tracker)
- `api_keys` (workspace-scoped for API + MCP access)

## MCP Server Tools (exposed to AI agents)
Auth: Bearer workspace API key
Tools: list_campaigns, create_campaign, update_campaign, pause_campaign,
       list_broadcasts, create_broadcast, schedule_broadcast, send_broadcast,
       list_contacts, create_contact, update_contact, delete_contact,
       list_segments, create_segment,
       list_templates, create_template, update_template,
       get_analytics, track_event

## ID Format
`{prefix}_{12-char-random}` — e.g. `ws_abc123def456`, `con_xyz789`, `cmp_...`
Prefixes: ws_ (workspace), usr_ (user), con_ (contact), seg_ (segment),
          evt_ (event), cmp_ (campaign), brd_ (broadcast), tpl_ (template),
          snd_ (send), eev_ (email event), key_ (api key)

## Railway Deployment
- Same GitHub repo, each service = subfolder root in Railway
- Env vars set per service in Railway dashboard
- Shared: DATABASE_URL, REDIS_URL
- api: BETTER_AUTH_SECRET, RESEND_API_KEY (platform default)
- tracker: API internal URL for reporting events back to api
- mcp: API internal URL

## Dev Commands
- `bun install` at root to install all workspace deps
- Each service: `bun dev` to run locally
- DB migrations: `bun db:migrate` in `api/` or `packages/shared/`

## Key Conventions
- No server actions — API routes only on client
- No polling — use webhooks/SSE
- No console.log — use pino logger
- Lazy init all services (env vars accessed inside functions, not module top-level)
- Firebase Timestamp pattern: always `.toDate().toISOString()` if applicable
- No parentheses in API route paths
- Hard delete only
- No fallbacks — let it fail

## GitHub / Open Source
- Repo: https://github.com/ShadowWalker2014/openmail (public)
- License: Elastic License 2.0 (ELv2) — free to self-host, no SaaS reselling
- Enterprise sales: kai@1flow.ai
- Topics: email-marketing, customer-io-alternative, mcp, ai-agents, self-hosted, typescript, hono, drizzle-orm, bullmq, resend, saas, plg
- CI: .github/workflows/ci.yml — tsc --noEmit on all 5 services

## Feature Flags / Notes
- Self-hosted (single tenant) + hosted SaaS (multi-tenant) both supported
- Template builder: visual drag-and-drop + raw HTML/code mode
- Event tracking: REST API + JS/Node SDK + webhook ingestion
