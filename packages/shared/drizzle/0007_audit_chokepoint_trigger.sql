-- Stage 2 [REQ-23], [A2.2], [DB-13], CR-14: Postgres audit chokepoint trigger.
--
-- Defense-in-depth correctness layer. Even if TS brand types + ESLint rule are
-- bypassed (raw SQL, ad-hoc psql, future agent-written code), this trigger
-- BLOCKS any UPDATE OF status on `campaigns` that is not wrapped in a
-- transaction setting `lifecycle.audited_tx = 'true'` (the GUC consumed by
-- `commitLifecycleStatus` and the `audited-migration` helper).
--
-- SCOPE NOTE — campaigns-only in Stage 2:
-- The original design called for triggers on BOTH `campaigns` and
-- `campaign_enrollments`. Round 5 verification revealed that the
-- `campaign_enrollments` trigger would block Stage 1's `step-advance.ts`
-- worker (which mutates enrollment.status directly when an enrollment
-- completes / fails / unsubscribes mid-flow). `step-advance.ts` is OFF-LIMITS
-- per Stage 1 invariants — Stage 3 will rewire the engine surface to thread
-- `lifecycle_op_id` through and route those mutations via
-- `commitLifecycleStatus()`. Until then, the enrollment-level trigger is
-- deferred (committed to a follow-up migration).
--
-- The campaigns trigger (this migration's only DDL) is what protects against
-- PATCH-alias drift, which was the explicit deviation flagged in Round 4.
-- After Round 5's PATCH-alias rewiring, the trigger admits all legitimate
-- status flips (verb endpoints + audited-migration helper + audited PATCH
-- alias) and rejects raw `UPDATE campaigns SET status = ...` calls.
--
-- ⚠️  DEPLOY ORDER:
-- This migration MUST be applied AFTER Rounds 1-4 (worker rerouting through
-- `commitLifecycleStatus`). Per Stage 2 plan v1.1.0 §"Schema migration order"
-- step D, [A2.19], task T7 execution gate. Pre-deploy gate:
--   1. Verify worker/src/lib/lifecycle-audit.ts exports `audit.emit`.
--   2. Verify worker/src/lib/commit-lifecycle-status.ts exports
--      `commitLifecycleStatus`.
--   3. Verify no direct `db.update(campaigns).set({status...})` outside the
--      helper (ESLint rule `no-direct-lifecycle-mutation` passes).
--   4. Verify PATCH /campaigns/:id routes status mutations through the
--      helper (Round 5 fix).
--   5. Run T22 audit-completeness tests on staging — all PASS — BEFORE this
--      migration touches production.

CREATE OR REPLACE FUNCTION audit_chokepoint_check() RETURNS trigger AS $$
BEGIN
  IF current_setting('lifecycle.audited_tx', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'lifecycle.audit_chokepoint: status mutation outside audited transaction (table=%, id=%)',
      TG_TABLE_NAME, COALESCE(NEW.id::text, '?');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_chokepoint_campaigns ON campaigns;
--> statement-breakpoint

CREATE TRIGGER audit_chokepoint_campaigns
  BEFORE UPDATE OF status ON campaigns
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION audit_chokepoint_check();
