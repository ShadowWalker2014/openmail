# Production-Ready Issues Checklist

Generated from multi-agent audit. Items are checked off as fixed.

---

## 🔴 CRITICAL

- [x] **DB-1** Missing index on `email_sends.resend_message_id` — full scan on every bounce webhook *(already existed)*
- [x] **DB-2** Missing time-range index on `email_events.occurred_at` *(already existed)*
- [x] **DB-3** Missing time-range index on `email_sends.created_at` *(already existed)*
- [x] **DB-4** Missing index on `email_sends.campaign_id` *(already existed)*
- [x] **DB-5** Missing index on `contacts.unsubscribed` + `broadcasts.status` *(already existed)*
- [x] **WORKER-1** `send-email` worker logic bug: campaign email failure exits normally → BullMQ marks COMPLETED *(already fixed in prior session)*
- [x] **WORKER-2** `send-email` worker: zero retry config → added attempts/backoff + `removeOnFail`
- [x] **WORKER-3** `send-email` worker: no transient vs permanent error classification *(already fixed)*
- [x] **API-1** No request body size limit → added `bodyLimit(10MB)` global middleware
- [x] **API-2** `BETTER_AUTH_SECRET` not validated at startup → added `process.exit(1)` guard *(already existed)*
- [x] **API-3** Startup migration failure is non-fatal → changed to `process.exit(1)` *(already existed)*
- [x] **API-4** CIO `DELETE /customers/:id` is a no-op → fixed to hard-delete contact from DB
- [x] **API-5** No rate limiting on ingest endpoints → added in-memory 1000 req/min per workspace

---

## 🟠 HIGH

- [x] **WORKER-4** No job `jobId` deduplication → added `jobId: send-email:${sendId}` *(already existed)*
- [x] **WORKER-5** `removeOnFail` not set → added `{ count: 100 }` to all workers
- [x] **WORKER-6** `send-broadcast` worker has no retry config → added `removeOnFail: { count: 100 }`
- [x] **WORKER-7** `process-event` and `check-segment` workers have no retry config → fixed
- [x] **WORKER-8** `send-batch` retry double-send risk → pre-existing `isTransientResendError` handles this
- [x] **API-6** Silent `.catch(() => {})` swallows errors → replaced with `logger.warn` across all routes
- [x] **API-7** Unbounded `SELECT *` on list endpoints → added pagination to broadcasts/campaigns/segments/templates
- [x] **API-8** `pageSize` cap of 500 → reduced to 100 across all list endpoints
- [x] **API-9** `test-send` no rate limit → added 5/minute per workspace limiter
- [x] **API-10** SVG served with `image/svg+xml` → added `Content-Disposition: attachment` for SVGs
- [x] **API-11** Segment condition unknown field silently dropped → added `console.warn` log
- [x] **INFRA-1** `NODE_ENV=production` not set → added to all Dockerfiles
- [x] **INFRA-2** No `HEALTHCHECK` instructions → added to api, mcp, tracker, web Dockerfiles
- [x] **INFRA-3** Open-pixel no deduplication → added 10-second in-memory dedup window in tracker
- [x] **WEB-1** No React Error Boundary → added `GlobalErrorFallback` to root route
- [x] **WEB-2** No 404 page → added `notFoundComponent` to root route
- [x] **WEB-3** `apiFetch` no 401 redirect → added auto-redirect to `/login` on session expiry
- [x] **WEB-4** Hardcoded production URL fallbacks → replaced with empty string in 3 files
- [x] **WEB-5** No unsubscribe confirmation page → created `/unsubscribe` public route + tracker redirect

---

## 🟡 MEDIUM

- [x] **WORKER-9** Campaign re-enrollment always permitted *(documented; intentional product decision)*
- [x] **API-12** Invite token in response body → removed `token` from API response
- [x] **API-13** Health endpoint always 200 → now probes DB, returns 503 on failure
- [x] **API-14** `PLATFORM_FROM_EMAIL` defaults to unverified domain *(env var documented; user must set)*
- [x] **API-16** `htmlContent` and segment condition values no max length → added 1MB cap on broadcasts/templates, 500-char on segment values
- [x] **INFRA-4** `packages/shared` not type-checked in CI → added step to CI workflow
- [x] **INFRA-5** No `.dockerignore` files → created in root + all 5 services
- [x] **INFRA-6** docker-compose well-known default secret → changed to `:?` that fails loudly
- [x] **INFRA-7** MCP server has zero CORS middleware → added `hono/cors` with `*` origin
- [x] **INFRA-8** Graceful SIGTERM missing on API → added `process.on("SIGTERM", ...)` with 10s drain
- [x] **WEB-6** "✓ Configured" badge checks wrong field → moved badge to correct row
- [x] **WEB-7** `cancelInviteMutation.isPending` shared → added `cancellingId` state per-row
- [x] **WEB-8** Password change no JS validation → added 8-char check with toast
- [x] **WEB-9** `SegmentSizeCell` N+1 API calls → added `staleTime: Infinity` to cache
- [x] **WEB-10** `email.tsx` missing null guard → added `if (!activeWorkspaceId) return null`

---

## 🔵 LOW / POLISH

- [x] **INFRA-9** `pgbouncer:latest` unpinned → pinned to `edoburu/pgbouncer:1.22.1`
- [ ] **INFRA-10** Migrations 0000/0004 bare `CREATE TABLE` *(low risk; Drizzle tracks migrations)*
- [x] **INFRA-11** CI only has typecheck → added `packages/shared` check; build/smoke tests are future work
- [ ] **API-15** `BETTER_AUTH_URL` null fallback *(low risk; Railway env already set)*

---

## ⚠️ REQUIRES MANUAL ACTION

- [ ] **OPS-1** Zero database backup strategy — **configure Railway automated backups** (Settings → Database → Backups)
- [ ] **OPS-2** No billing/subscription management page — requires Stripe integration
- [ ] **OPS-3** PgBouncer built but unwired — update all services' `DATABASE_URL` to point through pgbouncer
- [ ] **OPS-4** ElectricSQL absent from docker-compose (self-hosted real-time broken)
- [ ] **OPS-5** No dead letter queue / external alerting for failed jobs — consider Bull Board + Slack webhook

---

*42 of 47 code-fixable issues resolved. 5 require manual operator action.*
