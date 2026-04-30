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

## MCP Server (exposed to AI agents)
Auth: Bearer workspace API key
Public URL: https://mcp.openmail.win/mcp (SaaS default — self-hosters override via `MCP_PUBLIC_URL`)
Source: mcp/src/index.ts — tools in mcp/src/tools/, prompts in mcp/src/prompts.ts, resources in mcp/src/resources.ts
Capabilities: tools (CRUD for contacts/broadcasts/campaigns/segments/templates/analytics/assets),
              prompts (workflow templates for common tasks),
              resources (live docs via llms.txt, dynamic page lookup)

### Deployment Config Discovery (`GET /api/session/config`)
- Single source of truth for the dashboard's view of public-facing URLs.
- Source: `api/src/routes/config.ts`. Auth: session (logged-in users only). Returns `{ apiUrl, mcpUrl, mcpUrlSource, docsUrl, docsUrlSource, mcp: { authScheme, keysHref }, version }`.
- **Resolution chain** (no SaaS hardcodes — ever):
  1. **Explicit override:** `MCP_PUBLIC_URL` / `DOCS_PUBLIC_URL` env vars on the api service.
  2. **Convention-based derivation** from `BETTER_AUTH_URL` / `WEB_URL` (which IS the deployment's reality — these are mandatory env vars):
     - `https://api.<base>` → `https://mcp.<base>/mcp` (subdomain swap)
     - `http://localhost:<port>` → `http://localhost:<MCP_PORT|3002>/mcp` (local dev)
     - `https://app.<base>` → `https://docs.<base>` (docs subdomain swap)
     - bare host without convention → `<host>/docs` for docs path-prefix
  3. **`null`** if nothing applies. Dashboard renders a "MCP not configured for this deployment" warning. We do NOT fall back to upstream's SaaS host — that would silently misconfigure self-hosted deployments.
- `mcpUrlSource` / `docsUrlSource`: `"explicit" | "derived" | "unconfigured"`. UI uses these to show appropriate hints (e.g. "Auto-detected — set MCP_PUBLIC_URL to override" for derived).
- **Forward-compat discipline:** fields are append-only once shipped. `mcp.authScheme` is a versioned literal — when MCP scheme changes (e.g. to "oauth-2.1"), the value changes in lockstep with the dashboard's setup UI variant.
- The dashboard's `Settings → MCP Server` page (`web/src/routes/_app/settings/mcp-server.tsx`) is the only consumer today. Future SDK auto-config could also hit it.
- **MUST NOT** hardcode `mcpUrl` anywhere in `web/`. Always read from this endpoint.

### MCP Maintenance Rules (MUST follow when changing the underlying system)
- **New API route added?** → Add a corresponding MCP tool in mcp/src/tools/
- **API route removed/renamed?** → Remove/rename the MCP tool — stale tools confuse AI agents
- **New feature (e.g. new entity type)?** → Consider adding a prompt template in mcp/src/prompts.ts
- **DO NOT hardcode** tool names, API endpoint lists, or counts in prompts.ts or resources.ts
  — these go stale instantly. Reference the live docs URL instead: https://openmail.win/docs/llms.txt
- **DO NOT hardcode** tool/prompt/resource counts in docs or llms.txt — use "call list endpoints to discover"
- After MCP changes: run `bun run mcp:test` (if available) or verify with a real MCP client

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
- DB migrations: `bun db:migrate` in `api/` or `packages/shared/` (use DIRECT_DATABASE_URL or direct Postgres URL — NOT PgBouncer URL)
- Drizzle Studio (prod DB admin UI): `cd packages/shared && DIRECT_DATABASE_URL="postgresql://postgres:fecf91ffa1c07973e52f3e1ca1684be763fe78f6@maglev.proxy.rlwy.net:22853/openmail" bun drizzle-kit studio` → open https://local.drizzle.studio
- PgBouncer: All app services connect via pgbouncer.railway.internal:6432 (transaction pool mode). `prepare: false` set in db/client.ts. Direct Postgres URL needed for drizzle-kit and ElectricSQL only.

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

## Resend Webhooks
- Registered at: https://openmail.win/api/webhooks/resend (ID: fe8851ec-9475-47d5-a721-b7624712c70b)
- Events: email.bounced, email.complained
- Handler: api/src/routes/webhooks.ts — mounted as PUBLIC route (no auth guard), Svix signature verified
- RESEND_WEBHOOK_SECRET set in Railway api service
- On bounce: emailSends.status → "bounced", contact.unsubscribed = true, broadcasts.bounceCount++
- On complaint: emailSends.status → "failed", contact.unsubscribed = true, broadcasts.complaintCount++
- Signature: uses `svix` package, onError handler returns 401 on WebhookVerificationError
- Analytics: bounces/complaints/bounceRate/complaintRate now in GET /analytics/overview + /analytics/broadcasts/:id

## Nginx / Private Networking
- web/start.sh extracts nameserver from /etc/resolv.conf at startup (Railway uses IPv6: fd12::10)
- Injects into nginx.conf __DNS_RESOLVER__ placeholder before starting nginx
- This fixes api.railway.internal DNS resolution (127.0.0.11 is NOT available in Railway containers)

## Feature Flags / Notes
- Self-hosted (single tenant) + hosted SaaS (multi-tenant) both supported
- Template builder: visual drag-and-drop + raw HTML/code mode
- Event tracking: REST API + JS/Node SDK + webhook ingestion

## Campaign Step Progression Engine (Stage 1, shipped 2026-04-29)

Multi-step campaigns now progress through all positions end-to-end. Source: `PRPs/campaign-engine-fix/` (plan v1.1.0, validated, 54/54 integration tests pass).

- **Worker queue:** `step-execution` — BullMQ delayed jobs handle wait-step expiry (NOT setTimeout, NOT cron, NOT DB polling). Registered in `worker/src/index.ts` alongside the other 5 workers.
- **Helper module:** `worker/src/lib/step-advance.ts` — single source of truth for engine progression. Exports:
  - `enqueueNextStep(enrollmentId, completedPosition)` — enqueue-FIRST then UPDATE ordering to avoid stranded enrollments; defensively re-checks `unsubscribed` on every step.
  - `cancelEnrollmentJob(enrollmentId, currentStepId)` — exact-jobId remove (no SCAN — CN-02).
- **Deterministic jobIds** — enables exact-jobId cancellation without storing a `scheduledJobId` column:
  - Wait jobs: `step-execution:{enrollmentId}:{stepId}`
  - Email sends: `send-email:{sendId}:0` (trailing `:0` satisfies BullMQ 5.x's "0 or 2 colons" jobId rule)
- **Engine entry points** (every place that can enroll a contact calls `enqueueNextStep` with `completedPosition = -1`):
  - `worker/src/jobs/process-event.ts` — event-triggered enrollment
  - `worker/src/jobs/check-segment.ts` — segment-trigger enrollment
  - `worker/src/jobs/send-email.ts` — post-send hook calls `enqueueNextStep(enrollmentId, currentStepPosition)` after BOTH success AND permanent failure
  - `worker/src/jobs/process-step.ts` — wait-step expiry handler (4-step idempotency: enrollment exists → active → currentStepId pointer-equals stepId → step row exists)
- **Cancellation:** `api/src/lib/campaign-cancel.ts` exports `cancelCampaignJobs(campaignId, terminalStatus)` — fired by:
  - `PATCH /campaigns/:id` on `active → paused` and any `* → archived`
  - `DELETE /campaigns/:id` (BullMQ jobs are NOT cascade-deleted from Redis, so cancel before DB cascade)
- **Schema:** zero migrations needed. Existing `campaign_enrollments.currentStepId` is updated by `enqueueNextStep`; deterministic jobIds make a new column unnecessary.
- **Bull Board:** `step-execution` queue visible in `api/src/lib/bull-board.ts`.

## Rate Limiting (Stage 1)

`api/src/lib/rate-limiter.ts` — Redis-backed fixed-window counter, cross-replica safe.

- **Algorithm:** fixed-window via atomic Lua EVAL (`INCR` + `PEXPIRE`-on-first-hit so TTL is set exactly once per window). NOT token bucket, NOT leaky bucket — explicit per Stage 1 plan CN-03. Trade-off: known burst-at-boundary (up to 2× cap in adjacent windows); accepted in plan §3 Step 5.
- **Signature:** `rateLimit(bucket, id, limit, windowMs) → {allowed, current, resetMs}`
- **Consumers:**
  - `api/src/routes/ingest.ts` — per-API-key cap on `/api/ingest/*` (PostHog + Customer.io ingest paths). Partition key is `sha256(rawKey).slice(0,16)` — secret never enters Redis keyspace.
  - `api/src/routes/broadcasts.ts` — per-workspace cap on broadcast `test-send` (5 / workspace / minute).
- **Defaults:** window 60s, cap 1000/window — both env-configurable (`RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_DEFAULT_PER_WINDOW`). 429 responses include `Retry-After: ceil(resetMs/1000)`.
- **Cross-replica safety:** all api replicas share the same Redis key; per-process in-memory limiters were the bug Stage 1 replaced. **Do NOT add per-process in-memory limiters.**
- **Fail-open posture:** Redis errors are logged via pino + the request proceeds. Rationale: a brief Redis hiccup shouldn't 5xx the customer-facing event collection path; the cap re-engages as soon as Redis is reachable again.
- **Connection:** dedicated ioredis instance with `maxRetriesPerRequest: 1` (fail-fast); does NOT reuse the BullMQ queue connection because BullMQ's connection has different retry semantics.

## SOTA Lifecycle Engine — Stage 6 (Timeline + Replay + Reconciliation + Archival + GDPR, shipped 2026-05-01)

Stage 6 closes the SOTA Lifecycle Engine PRP family. Source: [`PRPs/sota-lifecycle-engine/`](PRPs/sota-lifecycle-engine/).

### Schemas + migration
- `packages/shared/src/db/schema/enrollment-events-archive.ts` — identical layout to `enrollment_events` plus `archived_at`; smaller index footprint (only `(enrollment_id, emitted_at)` + `(workspace_id, emitted_at)`); no event_type CHECK (accepts whatever was valid at archival time).
- `packages/shared/src/db/schema/campaign-edit-outbox.ts` — transactional outbox per [A6.1]: `(workspace_id, campaign_id, edit_type, details JSONB, lifecycle_op_id, created_at, forwarded_at NULL)` with partial index `WHERE forwarded_at IS NULL`. Edit types: `wait_duration_changed`, `step_inserted`, `step_deleted`, `email_template_changed`, `goal_added/updated/removed`.
- `packages/shared/drizzle/0013_archive_outbox.sql` — creates both tables and extends `enrollment_events_event_type_check` with 4 new types (`audit_drift_detected`, `events_archived`, `pii_erased`, `reconciliation_chunk_progress`).
- 32 lifecycle event types in SSOT (`packages/shared/src/lifecycle-events.ts`).

### Replay tool
- `worker/src/lib/replay-state-model.ts` — pure-function `applyEvent(state, event)` reconstructs per-enrollment final state. Mirrors the `campaign_enrollments` columns the diff cares about: `status, currentStepId, stepEnteredAt, nextRunAt, pausedAt, forceExitedAt, staleSkippedAt, completedAt, completedViaGoalId, spreadToken, stepHeldAt`.
- `scripts/lib/replay-event-dispatch.ts` — exhaustive switch on `(event_type, payload_version)` with TypeScript `never` exhaustiveness check (CR-04). Validates payload via Zod schemas (`packages/shared/src/lifecycle-events-payload-schemas.ts`) before applying. Redacted (GDPR) payloads → warning + skip (NOT drift). Schema mismatch / unknown version → warning + skip.
- `scripts/replay-enrollment.ts` — CLI tool: `bun run scripts/replay-enrollment.ts --workspace-id <ws> --enrollment-id <eev> [--include-archive] [--apply-fix] [--json]`. Per CR-17: `--workspace-id` REQUIRED and asserted against the row's actual workspace; mismatch → exit 1. Per CR-01: `--apply-fix` is recognised but NO-OP in this iteration. Exit codes: 0 match, 1 errors, 2 drift detected.

### Workers (in `worker/src/jobs/`)
- `process-outbox.ts` — `lifecycle-outbox-poller` repeatable cron (every `LIFECYCLE_OUTBOX_POLL_INTERVAL_MS`, default 1s). Reads up to `LIFECYCLE_OUTBOX_BATCH_SIZE` (default 100) `forwarded_at IS NULL` rows via `FOR UPDATE SKIP LOCKED`, publishes each to Redis channel `campaign-edits`, marks `forwarded_at = now()`. Single tx so a publish failure doesn't mark the row forwarded. Cross-replica safe.
- `process-edit-reconciliation.ts` — subscribes to Redis `campaign-edits` channel + pushes received messages into `lifecycle-edit-reconciliation` BullMQ queue (so retry semantics apply). Idempotency: Redis `SET reconciled:edits:{lifecycle_op_id} EX 86400 NX`. Per edit_type:
  - `wait_duration_changed` → cancel old wait job, recompute `next_run_at = step_entered_at + new delaySeconds`, re-enqueue, emit per-enrollment `reconciled` event.
  - `step_inserted/email_template_changed/goal_updated/removed` → aggregate `reconciled` only (no per-enrollment work).
  - `step_deleted` → aggregate `reconciled` (per-enrollment advance happens at API layer via Stage 4 helper).
  - `goal_added` → enqueue paginated `process-goal-add-reconciliation` worker.
  - Frozen-status guard: if campaign in `stopping/stopped/archived`, skip + log (API rejects too at T12).
- `process-goal-add-reconciliation.ts` — `lifecycle-goal-add-reconciliation` queue. Streams enrollments in chunks (`LIFECYCLE_RECONCILIATION_CHUNK_SIZE`, default 1000) via `(campaign_id, status='active') ORDER BY id` cursor. Per chunk own tx; per enrollment: load contact + run `evaluateGoals` (Stage 5 helper); on match, cancel BullMQ FIRST then UPDATE per Stage 5 [CR-12] order. Emits `reconciliation_chunk_progress` per chunk + final aggregate `reconciled` with `{total_processed, total_matched, duration_ms}`.
- `process-event-archival.ts` — `lifecycle-archival` repeatable cron (`LIFECYCLE_ARCHIVAL_CRON`, default `0 4 * * *`). Cutoff: `LIFECYCLE_AUDIT_RETENTION_DAYS` days ago (default 180). Per workspace: `pg_advisory_xact_lock(hashtext('archival:workspace:'||id))` + `SET LOCAL application_name = 'archival-low-priority'`. Single-statement DELETE+INSERT via WITH CTE + `FOR UPDATE SKIP LOCKED`, batch size `LIFECYCLE_ARCHIVAL_BATCH_SIZE` (default 10000), capped at 100 batches per workspace per run. Emits aggregate `events_archived` (synthetic `campaignId="__archival__"`) on completion. **Does NOT acquire table-level locks** (CN-11).
- `process-drift-sweep.ts` — `lifecycle-drift-sweeper` repeatable cron (`LIFECYCLE_DRIFT_SWEEPER_CRON`, default `0 3 * * *`). Picks top-100 active workspaces (24h mutation volume), samples up to `LIFECYCLE_DRIFT_MAX_PER_WORKSPACE` (default 100) recently-mutated enrollments, replays each in-process via the dispatcher, emits per-enrollment `audit_drift_detected` on mismatch + warns to pino. **Alert-only** per CN-06 — never auto-fixes.
- `process-pii-erasure.ts` — `lifecycle-pii-erasure` queue (manual enqueue from API contact-delete handler — NOT cron). Walks both `enrollment_events` and `enrollment_events_archive` for `(contact_id, workspace_id)` pairs. UPDATEs payload/before/after to `{redacted: true, reason: 'gdpr_erasure', redacted_at, original_event_type, lifecycle_op_id}`. **Preserves bit-exact** (CR-15): `id, event_type, emitted_at, event_seq, actor, tx_id, payload_version, enrollment_id, campaign_id, contact_id, workspace_id`. Emits campaign-aggregate `pii_erased` event per campaign the contact had events in. **This is the ONLY exception to Stage 2 [CN-08] append-only invariant.**

### API edit handlers + outbox writes (T12)
Per CR-11, every handler INSERTs into `campaign_edit_outbox` in the SAME `db.transaction()` as the entity write. Helper: `api/src/lib/campaign-edit-outbox.ts` exports `insertEditOutbox(tx, {workspaceId, campaignId, editType, details, lifecycleOpId})` and `isCampaignFrozen(status)`.

- `POST /:id/steps` — emits `step_inserted` outbox row when campaign status is `active` or `paused` (draft has no in-flight to reconcile).
- `PATCH /:id/steps/:stepId` — detects `wait_duration_changed` (when `oldDurationSeconds !== newDurationSeconds` for wait steps) or `email_template_changed` (when `templateId` differs for email steps); emits matching outbox row.
- `DELETE /:id/steps/:stepId` — emits `step_deleted` outbox row in BOTH the paused-step-with-held-enrollments tx AND the simple-delete tx.
- `POST /:id/goals` / `PATCH /:id/goals/:goalId` / `DELETE /:id/goals/:goalId` — emits `goal_added` / `goal_updated` / `goal_removed` outbox rows (existing audit emit kept; outbox is additive).
- All handlers reject (HTTP 409) on `stopping/stopped/archived` per [REQ-28].

### Timeline UI + ElectricSQL
- `api/src/routes/shapes.ts` — `enrollment_events` added to `ALLOWED_TABLES` (workspace-scoped per CN-05).
- `web/src/hooks/use-enrollment-events.ts` — wraps `useWorkspaceShape<EnrollmentEventRow>("enrollment_events")` and filters in-memory by `enrollment_id`, sorted by `event_seq` ascending.
- `web/src/components/timeline/event-row.tsx` — minimal MVP component: event_type label + timestamp + actor + expandable payload/before/after diff. Detects redacted payloads + shows badge.
- `web/src/routes/_app/campaigns/$id/timeline.tsx` — campaign-wide most-recent-200 events page.
- `web/src/routes/_app/campaigns/$id/enrollments/$enrollmentId.tsx` — per-enrollment full timeline drill-down.
- **Gap (deferred):** filter toolbar (event_type multi-select, date range, actor), CSV/JSON export, icon-per-event-type, actor avatars. The minimal MVP ships the core read path; export + advanced filters are follow-ups.

### API timeline endpoint + MCP + SDK (T15)
- `GET /api/v1/campaigns/:id/enrollments/:enrollmentId/events?limit=&before=&event_types=&include_archive=` — paginated, ordered DESC by `(event_seq, emitted_at)`. UNIONs the archive table when `include_archive=true`.
- MCP tool `get_enrollment_timeline` in `mcp/src/tools/lifecycle.ts` wraps the API endpoint; `mcp/src/lib/api-client.ts` extended `get` to accept `extraHeaders` for op-id propagation.
- SDK `client.campaigns.enrollments(campaignId).timeline(enrollmentId, opts?)` in `sdk/src/node/index.ts`.

### Worker bootstrap (`worker/src/index.ts`)
6 new workers added to the `workers` array:
1. `createOutboxWorker()` — outbox forwarder
2. `createEditReconciliationWorker()` — edit reconciliation
3. `createGoalAddReconciliationWorker()` — paginated goal-add
4. `createArchivalWorker()` — daily archival
5. `createDriftSweeperWorker()` — daily drift sample + alert
6. `createPiiErasureWorker()` — GDPR redaction

3 new repeatable schedules + 1 subscriber bootstrap installed at startup.

### Test coverage
- `api/src/integration/lifecycle-stage6.integration.test.ts` — 12 unit tests covering: replay state model lifecycle reconstruction; drift detection; redacted-payload opacity; payload-schema SSOT coverage; edit-type taxonomy (7 values); Stage 6 SSOT events present.
- All 12 Stage 6 tests pass; all 138 prior integration tests still pass (Stages 1-5 + lifecycle-goals + step-pause + spread + audit-completeness + ingest contracts + rate-limiter + campaigns + lifecycle).
- 1 pre-existing failure: `domains.integration.test.ts` (docker container startup, unrelated to Stage 6).

### Perf validation (completed 2026-04-30)
All previously-skipped extended/perf tests now run in [`api/src/integration/lifecycle-stage6.perf.test.ts`](api/src/integration/lifecycle-stage6.perf.test.ts) (12 tests, 62 assertions, ~21s on standing test infra). All pass within budget. Headline: archival 391M events/hour extrapolated (>1M target), timeline 1000 events at 3ms p95, replay 10k events in 35ms. See [`PRPs/sota-lifecycle-engine/06-perf-validation.md`](PRPs/sota-lifecycle-engine/06-perf-validation.md) for the full report.

**Two production bugs found & fixed during perf validation:**
1. `process-pii-erasure.ts` — Drizzle/postgres-js param type inference (42P18) on all 4 SQL statements; fixed with explicit `::text` casts. Without this, every GDPR Art. 17 erasure would have errored 500.
2. `process-event-archival.ts` — JS `Date` cannot bind to timestamptz placeholder; fixed with `.toISOString()` + `::timestamptz` cast. Without this, every nightly archival cron run would have errored.

Both bugs were invisible to existing integration tests because those tests didn't exercise `eraseContactOnce()` or `runArchivalOnce()` against a real Postgres instance.

## Known Limitations (internal — not yet disclosed publicly)

> Public-facing summary lives in [`ROADMAP.md`](ROADMAP.md). The items below are the internal-context technical detail.

- **Mid-flight email sends complete after pause (BullMQ semantics).** If a campaign is paused while a `send-email` job is mid-flight (Resend HTTP call in progress), the email goes out. The post-send `enqueueNextStep` call then sees `enrollment.status !== "active"` and skips advancement. So at most ONE extra email is sent after pause per in-flight enrollment. Documented design — cancelling mid-Resend-call would leak network state.
- **Permanent email failures advance enrollments (not dead-letter).** Per Stage 1 plan T6 design decision (validated by recalibration §2 D1; matches Customer.io behavior): a 4xx Resend response (bad recipient, blocked content) marks the send `failed` but ADVANCES the enrollment to the next step. Rationale: a single bad address shouldn't halt a multi-step campaign. Trade-off: a misconfigured template will silently complete every enrollment with all sends marked failed. Surface in dashboard via step-error counts (product follow-up).
- **Per-workspace rate-limit cap override is env-default only.** No per-tenant column on `workspaces` yet. If product wants per-tenant caps for enterprise plans, adding a `rate_limit_per_window` column + lookup before the EVAL is a small follow-up.
- **Replay auto-fix is OFF by default** ([→ ROADMAP](ROADMAP.md#roadmap-replay-auto-fix)). The `--apply-fix` flag is recognised but no-op in this iteration per CR-01 / CN-06 — auto-fix at scale is catastrophic on false positive. Drift sweeper is alert-only.
- **Cross-enrollment timeline UI is API-only.** Today the in-app timeline drills into a single enrollment. Campaign-wide views ship as a future stage.
- **Goal CRUD actor identification is `system`.** Stage 5 left this as a follow-up; Stage 6 added end-to-end timeline correlation via `lifecycle_op_id` but did not change the actor wiring. Future stage hardens to `{kind: "user", userId}` or `{kind: "agent_key", apiKeyId}`.
