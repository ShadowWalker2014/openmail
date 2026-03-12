# Production-Ready Issues Checklist

Generated from multi-agent audit. Items are checked off as fixed.

---

## 🔴 CRITICAL

- [ ] **DB-1** Missing index on `email_sends.resend_message_id` — full scan on every bounce webhook
- [ ] **DB-2** Missing time-range index on `email_events.occurred_at` — analytics full scans
- [ ] **DB-3** Missing time-range index on `email_sends.created_at` — analytics full scans
- [ ] **DB-4** Missing index on `email_sends.campaign_id`
- [ ] **DB-5** Missing index on `contacts.unsubscribed` + `broadcasts.status`
- [ ] **WORKER-1** `send-email` worker logic bug: campaign email failure exits normally → BullMQ marks COMPLETED, never retried
- [ ] **WORKER-2** `send-email` worker: zero retry config (defaults to 1 attempt, no backoff)
- [ ] **WORKER-3** `send-email` worker: no transient vs permanent error classification (429/503 = permanent fail)
- [ ] **API-1** No request body size limit — 500MB base64 payload buffered in memory before rejection
- [ ] **API-2** `BETTER_AUTH_SECRET` not validated at startup — null secret means all sessions forgeable
- [ ] **API-3** Startup migration failure is non-fatal — API starts serving on broken schema
- [ ] **API-4** CIO `DELETE /customers/:id` is a no-op — GDPR deletions silently ignored
- [ ] **API-5** No rate limiting on ingest endpoints — leaked API key can flood DB/Redis

---

## 🟠 HIGH

- [ ] **WORKER-4** No job `jobId` deduplication — concurrent workers cause double-sends
- [ ] **WORKER-5** `removeOnFail` not set — failed jobs accumulate in Redis forever
- [ ] **WORKER-6** `send-broadcast` worker has no retry config
- [ ] **WORKER-7** `process-event` and `check-segment` workers have no retry config
- [ ] **WORKER-8** `send-batch` retry-on-success race: Resend succeeds but DB update fails → retry re-sends all 100 emails (add idempotency guard)
- [ ] **API-6** Silent `.catch(() => {})` swallows segment check and invite email failures — add `logger.warn`
- [ ] **API-7** Unbounded `SELECT *` on broadcasts/campaigns/segments/templates list endpoints (no pagination)
- [ ] **API-8** `pageSize` cap of 500 too high — reduce to 100
- [ ] **API-9** `POST /broadcasts/:id/test-send` has no rate limit — spam relay risk
- [ ] **API-10** SVG files served with `image/svg+xml` — scripts execute if opened directly in browser
- [ ] **INFRA-1** `NODE_ENV=production` not set in any Dockerfile — `pino-pretty` runs in production
- [ ] **INFRA-2** No `HEALTHCHECK` instructions in any Dockerfile
- [ ] **INFRA-3** Open-pixel tracking has no deduplication — Apple MPP inflates open rates 2–5x
- [ ] **WEB-1** No React Error Boundary — any JS error = blank white screen
- [ ] **WEB-2** No 404 / not-found page — blank screen on unknown routes
- [ ] **WEB-3** `apiFetch` no 401 → auto-redirect to `/login` on session expiry
- [ ] **WEB-4** Hardcoded production API URL fallbacks in `auth-client.ts`, `use-workspace-shape.ts`, `assets/index.tsx`
- [ ] **WEB-5** No unsubscribe confirmation page (CAN-SPAM / GDPR compliance gap)

---

## 🟡 MEDIUM

- [ ] **WORKER-9** Campaign re-enrollment always permitted — no `allowReEnrollment` flag; every event re-activates completed campaigns
- [ ] **API-11** Segment condition unknown field silently dropped — should log warn
- [ ] **API-12** Invite token included in response body (shows in server logs)
- [ ] **API-13** `PLATFORM_FROM_EMAIL` defaults to unverified `noreply@openmail.dev`
- [ ] **INFRA-4** `packages/shared` not type-checked in CI
- [ ] **INFRA-5** No `.dockerignore` files — risk of leaking `.env.local` into build context
- [ ] **INFRA-6** `docker-compose.yml` uses well-known default `BETTER_AUTH_SECRET` fallback
- [ ] **INFRA-7** MCP server has zero CORS middleware
- [ ] **INFRA-8** Graceful SIGTERM handler missing on API service (add drain before exit)
- [ ] **WEB-6** `email.tsx` settings "✓ Configured" badge checks wrong field (`resendFromEmail` not API key)
- [ ] **WEB-7** `cancelInviteMutation.isPending` shared across all invite rows — disables all buttons
- [ ] **WEB-8** Password change: no JS-level length validation (HTML `minLength` bypassed)
- [ ] **WEB-9** `SegmentSizeCell`: N+1 API call per segment row on page load
- [ ] **WEB-10** `email.tsx` settings: missing `activeWorkspaceId` null guard

---

## 🔵 LOW / POLISH

- [ ] **INFRA-9** `pgbouncer:latest` Docker tag unpinned
- [ ] **INFRA-10** Migrations 0000/0004 use bare `CREATE TABLE` without `IF NOT EXISTS`
- [ ] **INFRA-11** CI has no build, lint, or smoke-test jobs — only typecheck
- [ ] **API-14** Health endpoint always returns 200 regardless of DB/Redis state
- [ ] **API-15** `BETTER_AUTH_URL` falls back to `undefined` if env var missing — null base URL
- [ ] **API-16** `htmlContent` and segment condition values have no max-length cap

---

## ⚠️ REQUIRES MANUAL ACTION (document only)

- [ ] **OPS-1** Zero database backup strategy — configure Railway automated backups or pg_dump cron
- [ ] **OPS-2** No billing / subscription management page — requires Stripe integration
- [ ] **OPS-3** PgBouncer built but completely unwired — wire `DATABASE_URL` through pgbouncer for connection pooling
- [ ] **OPS-4** ElectricSQL absent from docker-compose (self-hosted real-time sync broken)
- [ ] **OPS-5** No dead letter queue or external alerting for permanently failed BullMQ jobs

---

*Legend: Fixed items get `[x]`. Manual-action items document the gap but are not auto-fixable.*
