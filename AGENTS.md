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

## ElectricSQL Real-time Sync
- Service: `electric` on Railway (electricsql/electric:latest image, port 3000)
- Wired directly to Postgres (NOT via PgBouncer — needs logical replication)
- DATABASE_URL = direct postgres.railway.internal connection
- ELECTRIC_SECRET = server-side only (never exposed to browser)
- Postgres requires: wal_level=logical, max_replication_slots=10, max_wal_senders=10
  → Set via Postgres service startCommand: `docker-entrypoint.sh postgres -c wal_level=logical ...`
- API proxy: `/api/session/ws/:workspaceId/shapes/:table`
  → Validates session auth, enforces workspace_id scope, forwards to Electric
  → Allowed tables: broadcasts, email_events, email_sends, contacts, campaigns, campaign_enrollments, events
- Frontend hook: `useWorkspaceShape<T>(table, options)` in web/src/hooks/use-workspace-shape.ts
- Real-time features using ElectricSQL:
  → Broadcasts page: live send progress bar (sent_count/recipient_count)
  → Dashboard: live activity feed (opens, clicks, unsubscribes as they happen)
- @electric-sql/react + @electric-sql/client v1.0.41

## Feature Flags / Notes
- Self-hosted (single tenant) + hosted SaaS (multi-tenant) both supported
- Template builder: visual drag-and-drop + raw HTML/code mode
- Event tracking: REST API + JS/Node SDK + webhook ingestion

## Cursor Cloud specific instructions

### Infrastructure (Docker required)
Postgres 16 + Redis 7 run via `docker compose`. Start them before any service:
```bash
sudo dockerd &>/tmp/dockerd.log &
sleep 3
sudo docker compose -f /workspace/docker-compose.yml up -d postgres redis
```
Wait for healthy status before proceeding. Get container IPs for env files:
```bash
POSTGRES_IP=$(sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' workspace-postgres-1)
REDIS_IP=$(sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' workspace-redis-1)
```

### Environment files
Each service needs `.env.local` (gitignored). See `.env.example` in each service. Key local dev notes:
- `DATABASE_URL` — postgres connection using Docker container IP
- `REDIS_URL` — redis connection using Docker container IP
- `BETTER_AUTH_SECRET` — any 32+ char random string
- `BETTER_AUTH_URL` — set to API local address (port 3001)
- `RESEND_API_KEY` — placeholder value OK for dev; actual email sends require a real Resend key
- `DATABASE_SSL=false` (required in `packages/shared/.env.local` and `api/.env.local` for local Postgres without SSL)

### Drizzle SSL gotcha
`packages/shared/drizzle.config.ts` has `ssl: "require"` by default (for Railway). Set `DATABASE_SSL=false` in env to disable for local dev (the config reads this env var).

### Running services
Standard dev commands from root `package.json`: `bun dev:api`, `bun dev:web`, `bun dev:worker`, `bun dev:tracker`, `bun dev:mcp`.
- **Tracker port gotcha**: When running `bun dev:tracker` from workspace root via `bun --cwd tracker dev`, it may not pick up `PORT` from `tracker/.env.local`. Workaround: `cd tracker && PORT=3003 bun run --watch src/index.ts`.
- **pino-pretty**: Required as dev dep at root for pino logger pretty-printing in dev mode. Already added to root `package.json`.
- API health check: `curl localhost:3001/health`
- Tracker health check: `curl localhost:3003/health`

### Service ports
| Service | Port |
|---------|------|
| api | 3001 |
| mcp | 3002 |
| tracker | 3003 |
| web (Vite) | 5173 |
| worker | N/A (no HTTP) |

### DB migrations
```bash
cd packages/shared && DATABASE_URL="..." DATABASE_SSL=false bun x drizzle-kit migrate
```
Or from root: `DATABASE_SSL=false bun db:migrate` (if `packages/shared/.env.local` is set up).

### Type checking (CI lint)
No dedicated linter config; CI runs `tsc --noEmit` on all 5 services:
```bash
cd api && bun x tsc --noEmit
cd web && bun x tsc --noEmit
cd worker && bun x tsc --noEmit
cd mcp && bun x tsc --noEmit
cd tracker && bun x tsc --noEmit
```

### ElectricSQL (optional for local dev)
Dashboard "Live Activity" and Broadcasts real-time progress need ElectricSQL. Without it, the dashboard shows "Connecting to live feed..." — all other features work fine. Not blocking for development.

### Auth route path
Better Auth endpoints are at `/api/auth/*` on the API. The Vite dev server proxies `/api` → API on port 3001.
