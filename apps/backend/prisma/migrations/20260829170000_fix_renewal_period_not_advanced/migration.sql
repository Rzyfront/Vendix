-- DATA IMPACT:
-- Tables affected: store_subscriptions (1 row UPDATE), subscription_events (1 row INSERT)
-- Expected row changes: subscription 57 (store 96, "A&ftecnicell") returns to `active`
--   with the billing window of the invoice it already paid (SAAS-20260825-00001,
--   period 2026-08-25 -> 2026-09-24, payment 42 succeeded 2026-08-26 18:08:59Z,
--   Wompi NEQUI APPROVED ref 1439162-1787767652-44367, 89900 COP).
-- Destructive operations: none. No DELETE, no TRUNCATE, no DROP, no CASCADE, no schema change.
-- FK/cascade risk: none. Scalar UPDATE plus the INSERT of a child audit row whose only
--   FK (store_subscription_id) points at the row being corrected.
-- Idempotency: guarded by `s.current_period_end < i.period_end`. Once applied the
--   predicate is false, so a re-run selects nothing and exits as a NOTICE no-op.
-- Non-prod safety: additionally scoped to `s.id = 57 AND s.store_id = 96` and to the
--   existence of a `paid` invoice with a `succeeded` payment. Any database where that
--   exact invariant is absent (dev, staging, a already-corrected prod) is a no-op.
-- Approval: granted by the user in chat on 2026-08-29 ("ejecuta"), plan reviewed and
--   approved under how-to-plan before execution.
--
-- WHY THIS MIGRATION EXISTS
-- `SubscriptionStateService.ensureOperationalInTxInternal` returned early whenever the
-- subscription was already `active`/`trial`, and that `return` sat before
-- `applyReactivationWindow`, the single writer of `current_period_*`. A renewal paid in
-- the gap between a period lapsing and the `subscription-state-engine` cron degrading the
-- row therefore never advanced the window:
--   ENSURE_OPERATIONAL_NOOP store=96 state=active reason=payment_42_approved
-- The cron then read the stale `current_period_end` (2026-08-25) and moved the store
-- `active` -> `grace_soft` on 2026-08-29 03:00Z, with `grace_hard` due 2026-09-01 and
-- suspension 2026-09-04 — on a store that had paid three days earlier.
--
-- The seam is fixed in code in the same change; this migration repairs the one row that
-- the defect already damaged, because nothing else will: `reconcile-stuck-pending.job.ts`
-- only sweeps `pending_payment`, so `grace_soft` has no automatic recovery path.
--
-- The window written is the INVOICE's own period, not `now + cycle`: the customer paid
-- for a specific window and that is the window they get.

DO $$
DECLARE
  v_prev_state    store_subscription_state_enum;
  v_invoice_id    INT;
  v_invoice_no    VARCHAR;
  v_period_start  TIMESTAMP;
  v_period_end    TIMESTAMP;
  v_payment_id    INT;
  v_updated       INT;
BEGIN
  SELECT s.state, i.id, i.invoice_number, i.period_start, i.period_end, p.id
    INTO v_prev_state, v_invoice_id, v_invoice_no, v_period_start, v_period_end, v_payment_id
  FROM store_subscriptions s
  JOIN subscription_invoices i
    ON i.store_subscription_id = s.id
   AND i.state = 'paid'
  JOIN subscription_payments p
    ON p.invoice_id = i.id
   AND p.state = 'succeeded'
  WHERE s.id = 57
    AND s.store_id = 96
    AND s.current_period_end < i.period_end
  ORDER BY i.period_end DESC, p.id DESC
  LIMIT 1;

  IF v_invoice_id IS NULL THEN
    RAISE NOTICE 'fix_renewal_period_not_advanced: no-op — the paid-but-not-advanced invariant is not present in this database';
    RETURN;
  END IF;

  UPDATE store_subscriptions
     SET state                = 'active',
         current_period_start = v_period_start,
         current_period_end   = v_period_end,
         next_billing_at      = v_period_end,
         -- Deadlines derived from the period being replaced describe nothing.
         -- Left in place, the state engine degrades the store again tonight.
         grace_soft_until     = NULL,
         grace_hard_until     = NULL,
         suspend_at           = NULL,
         cancel_at            = NULL,
         lock_reason          = NULL,
         updated_at           = (NOW() AT TIME ZONE 'UTC')
   WHERE id = 57;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Row-count guard: the whole transaction aborts rather than commit a correction
  -- whose blast radius is not exactly the one row this migration reasoned about.
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'fix_renewal_period_not_advanced: expected exactly 1 updated row, got %', v_updated;
  END IF;

  INSERT INTO subscription_events (
    store_subscription_id, type, from_state, to_state, payload, triggered_by_job, created_at
  ) VALUES (
    57,
    'state_transition',
    v_prev_state,
    'active',
    jsonb_build_object(
      'reason', 'data_fix_renewal_period_not_advanced',
      'source', 'migration_20260829170000',
      'invoice_id', v_invoice_id,
      'invoice_number', v_invoice_no,
      'payment_id', v_payment_id,
      'restored_period_start', v_period_start,
      'restored_period_end', v_period_end,
      'previous_state', v_prev_state,
      'defect', 'ensureOperational returned before applyReactivationWindow while state was active'
    ),
    'migration_fix_renewal_period',
    (NOW() AT TIME ZONE 'UTC')
  );

  RAISE NOTICE 'fix_renewal_period_not_advanced: subscription 57 restored to active with period % -> % from invoice % (payment %)',
    v_period_start, v_period_end, v_invoice_no, v_payment_id;
END $$;
