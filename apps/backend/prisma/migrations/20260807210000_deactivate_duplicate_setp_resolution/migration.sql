-- DATA IMPACT:
-- Tables affected: invoice_resolutions
-- Expected row changes: exactly 1 UPDATE (id = 9), columns is_active + updated_at
-- Destructive operations: none — no DELETE, DROP, TRUNCATE or CASCADE
-- FK/cascade risk: none. The only inbound FK is invoices_resolution_id_fkey
--   (invoices.resolution_id, ON DELETE RESTRICT) and 0 rows of invoices
--   reference id = 9 (nor id = 10). Verified via pg_constraint before writing.
-- Idempotency: guarded by a full-fingerprint check plus WHERE is_active = true.
--   Re-running matches 0 rows.
-- Approval: user confirmed in chat — "la 9", the row is dirty seed data
-- Snapshot: invoice_resolutions dumped in full (5 rows) before applying
--
-- Organization 1 has DIAN resolution 18760000001 (prefix SETP, range
-- 990000000-995000000) active in TWO rows of invoice_resolutions:
--
--   id 9  -> accounting entity 18, current_number 989999999 (= range_from - 1,
--            never emitted a single document)
--   id 10 -> accounting entity 95, current_number 990000160 (burned the 50
--            consecutives of the habilitación test set already sent to DIAN)
--
-- Two active rows over the same authorized range are two independent counters.
-- Emitting through row 9 would produce 990000000 under a NIT that has already
-- delivered up to 990000160, and DIAN rejects duplicate numbering
-- DEFINITIVELY — that consecutive is never recoverable.
--
-- Row 9 is deactivated, not deleted: is_active = false already removes it from
-- every emission flow, and keeping the row preserves the audit trail of its
-- existence. Deleting it would also fight the inbound ON DELETE RESTRICT for no
-- benefit.
DO $$
DECLARE
  v_fingerprint int;
BEGIN
  SELECT count(*) INTO v_fingerprint
    FROM invoice_resolutions
   WHERE id = 9
     AND resolution_number = '18760000001'
     AND prefix = 'SETP'
     AND range_from = 990000000
     AND range_to = 995000000
     AND current_number = 989999999;

  IF v_fingerprint = 0 THEN
    -- The row is not the one that was measured and approved. Nothing is touched:
    -- a blind UPDATE here would deactivate a resolution other than the reviewed
    -- one. RAISE NOTICE instead of RAISE EXCEPTION on purpose — failing here
    -- would leave the migration in P3009 and block the deploy pipeline, whose
    -- recovery is more dangerous than a no-op. The post-deploy SELECT catches it.
    RAISE NOTICE 'invoice_resolutions id=9 does not match the approved fingerprint; migration is a no-op';
    RETURN;
  END IF;

  UPDATE invoice_resolutions
     SET is_active = false,
         updated_at = now()
   WHERE id = 9
     AND is_active = true;
END $$;
