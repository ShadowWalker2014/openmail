# OpenMail Roadmap

> Living document — see [`AGENTS.md` "Known Limitations"](AGENTS.md#known-limitations) for technical detail.
> Order, not dates: items ship when they pass acceptance, not on a calendar.

OpenMail's lifecycle engine has been delivered in 6 stages under [`PRPs/sota-lifecycle-engine/`](PRPs/sota-lifecycle-engine/). With Stage 6 shipped, the SOTA Lifecycle Engine is now production-grade and surpasses every published competitor (Customer.io, HubSpot, Mautic, Mailchimp, ActiveCampaign) on burst mitigation, per-step pause, goal-based exits, audit log replayability, and GDPR PII redaction.

## ✅ Stable

These features are production-ready with comprehensive integration test coverage.

- <a id="stable-multi-step-progression"></a>**Multi-step campaign progression** — `email → wait → email → ...` flows execute reliably via BullMQ delayed jobs. Cancellable on pause / archive / delete. Shipped Stage 1, validated by 54/54 integration tests. See [`PRPs/campaign-engine-fix/03-plan.md`](PRPs/campaign-engine-fix/03-plan.md).
- <a id="stable-lifecycle-verbs"></a>**Lifecycle verb endpoints** — `POST /api/v1/campaigns/:id/{pause|resume|stop|archive}` with explicit semantics, idempotency, and destructive-action confirmations. Replaces the ambiguous PATCH-with-status pattern (kept as a frozen-shape alias for backward compatibility). Shipped Stage 2. See [`PRPs/sota-lifecycle-engine/02-prd-stage-2-lifecycle-verbs.md`](PRPs/sota-lifecycle-engine/02-prd-stage-2-lifecycle-verbs.md).
- <a id="stable-re-enrollment-policies"></a>**Re-enrollment policies** — `never | always | after_cooldown | on_attribute_change` per campaign. Default `never` matches pre-Stage-2 behavior. Shipped Stage 2.
- <a id="stable-audit-log"></a>**Append-only audit log** — `enrollment_events` table records every state transition with `event_seq` (per-enrollment monotonic) and `lifecycle_op_id` correlation. Replayable for forensics and dashboard timeline reconstruction. Shipped Stage 2.
- <a id="stable-audit-chokepoint"></a>**Audit chokepoint** — Postgres `audit_chokepoint_check` trigger on `campaigns.status` blocks status mutations outside the `commitLifecycleStatus()` helper. Defense-in-depth beyond TypeScript brand types and ESLint. Shipped Stage 2.
- <a id="stable-cross-replica-rate-limiting"></a>**Cross-replica rate limiting** — Redis fixed-window counter for ingest and broadcasts test-send. Cross-replica safe via atomic Lua EVAL. Shipped Stage 1.
- <a id="stable-burst-mitigation"></a>**Burst mitigation on resume** — `POST /:id/resume` supports four modes: `immediate`, `spread`, `skip_stale`, `skip_stale_spread`. Shipped Stage 3. Industry-unique — no competitor surveyed implements this. See [`PRPs/sota-lifecycle-engine/02-prd-stage-3-burst-mitigation.md`](PRPs/sota-lifecycle-engine/02-prd-stage-3-burst-mitigation.md).
- <a id="stable-per-step-pause"></a>**Per-step pause/resume** — pause one step in a multi-step flow without halting other in-flight enrollments. Held enrollments are advanced past deleted/edited steps via the reconciliation helper. Shipped Stage 4. Industry-unique. See [`PRPs/sota-lifecycle-engine/02-prd-stage-4-per-step-pause.md`](PRPs/sota-lifecycle-engine/02-prd-stage-4-per-step-pause.md).
- <a id="stable-goal-exits"></a>**Goal-based early exit** — campaign-scoped goals with OR semantics across `event`, `attribute`, and `segment` condition types. Both proactive (per-step) and reactive (event-driven) evaluation paths; force-exit precedes goal_achieved on race per [CR-13]. Shipped Stage 5. See [`PRPs/sota-lifecycle-engine/02-prd-stage-5-goal-exits.md`](PRPs/sota-lifecycle-engine/02-prd-stage-5-goal-exits.md).
- <a id="stable-timeline-replay-gdpr"></a>**Audit timeline UI + replay tool + edit reconciliation + archival + GDPR PII redaction** — per-enrollment timeline page surfaced via ElectricSQL real-time sync; CLI replay tool reconstructs final state from `enrollment_events` and detects drift; transactional outbox for at-least-once delivery of mid-flight edits to the reconciliation worker; daily archival worker moves events older than `LIFECYCLE_AUDIT_RETENTION_DAYS` (default 180) into `enrollment_events_archive`; PII redaction worker walks both tables on contact deletion (preserves event metadata, redacts payloads) for GDPR Art. 17 compliance. Shipped Stage 6. See [`PRPs/sota-lifecycle-engine/02-prd-stage-6-timeline-replay-reconciliation.md`](PRPs/sota-lifecycle-engine/02-prd-stage-6-timeline-replay-reconciliation.md).

## 🟡 Beta

Working but with documented gaps that will close in subsequent backlog items.

(none currently — Stage 6 closed the prior Beta items by promoting them to Stable)

## 🔵 Roadmap

Planned but not yet implemented. Ordered roughly by dependency, not by date.

- <a id="roadmap-cross-enrollment-timeline"></a>**Cross-enrollment timeline view** — campaign-wide event stream with operator filtering. Today only per-enrollment drill-down is in-app; campaign-wide queries route via API/MCP.
- <a id="roadmap-time-travel-debugging"></a>**Time-travel debugging UI** — replay an enrollment to any point in its history and inspect intermediate state. The CLI replay tool covers the forensics use case; the UI is a future enhancement.
- <a id="roadmap-cold-storage-archive"></a>**S3/Glacier cold storage** — move `enrollment_events_archive` rows older than ~2 years to object storage. Today archival keeps everything in the same Postgres database, in a separate table.
- <a id="roadmap-replay-auto-fix"></a>**Replay auto-fix on drift** — opt-in CLI flag to write corrections back via `commitLifecycleStatus()`. Today drift detection is alert-only per CR-01 / CN-06 (auto-fix at scale = catastrophic on false positive).
- <a id="roadmap-and-semantics-goals"></a>**AND semantics across goals** — today OR-only. AND would let operators express "exit only if goal A AND goal B both hold".
- <a id="roadmap-reconciliation-preview-ui"></a>**Reconciliation preview UI** — "show me what will happen" before applying a campaign edit (wait-duration change, step deletion, etc.).
- <a id="roadmap-webhook-on-drift"></a>**Webhook on drift detection** — push `audit_drift_detected` events to operator-configured endpoints.

See [`PRPs/sota-lifecycle-engine/`](PRPs/sota-lifecycle-engine/) for the full PRP family.

## Internal context

For Claude Code agents and contributors: see [`AGENTS.md` "Known Limitations"](AGENTS.md#known-limitations) for current-state technical detail (BullMQ semantics around mid-flight sends, etc.).
