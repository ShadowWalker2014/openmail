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
| Storage | Railway Object Storage (S3-compatible) + @aws-sdk/client-s3 |
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
- `assets` (uploaded files: images/video/PDF — stored in Railway Object Storage S3)

## MCP Server Tools (exposed to AI agents)
Auth: Bearer workspace API key
Public URL: https://mcp.openmail.win/mcp
Tools (27): list_campaigns, create_campaign, update_campaign, pause_campaign,
 list_broadcasts, get_broadcast, create_broadcast, update_broadcast, schedule_broadcast, send_broadcast, delete_broadcast,
 list_contacts, create_contact, update_contact, delete_contact, track_event,
 list_segments, create_segment,
 list_templates, create_template, update_template, delete_template,
 get_analytics, get_broadcast_analytics,
 list_assets, get_asset, upload_asset_from_url, upload_asset_base64, delete_asset

## ID Format
`{prefix}_{12-char-random}` — e.g. `ws_abc123def456`, `con_xyz789`, `cmp_...`
Prefixes: ws_ (workspace), usr_ (user), con_ (contact), seg_ (segment),
          evt_ (event), cmp_ (campaign), brd_ (broadcast), tpl_ (template),
          snd_ (send), eev_ (email event), key_ (api key)

## Asset Storage (Railway Object Storage)
- S3-compatible bucket; private buckets only (no public ACL support)
- Client uploads directly via presigned PUT URL (5min expiry) — API never proxies bytes on upload
- Public serving: `GET /api/public/assets/:wsId/:assetId` — no auth, for embedding in emails
- Env vars (auto-injected when bucket linked in Railway dashboard): AWS_ENDPOINT_URL, AWS_DEFAULT_REGION, AWS_S3_BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
- api service wired with `${{Storage.AWS_*}}` Railway references
- `api/src/lib/storage.ts` — lazy-init S3 client, generateUploadUrl, getObject, deleteObject, isStorageConfigured
- `api/src/routes/assets.ts` — CRUD + presigned URL generation
- `web/src/routes/_app/assets/index.tsx` — grid UI with drag-and-drop upload, copy-URL, delete

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
- Drizzle Studio (prod DB admin UI): `cd packages/shared && DATABASE_URL="postgresql://postgres:fecf91ffa1c07973e52f3e1ca1684be763fe78f6@maglev.proxy.rlwy.net:22853/openmail" bun drizzle-kit studio` → open https://local.drizzle.studio

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
