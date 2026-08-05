-- DATA IMPACT:
-- Tables affected: invoice_resolutions, dian_configurations
-- Expected row changes:
--   (1) invoice_resolutions: rows whose cursor drifted BELOW their authorized
--       floor get current_number = range_from - 1. In dev this is exactly 1 row
--       (id 41, the platform SETP resolution, current_number = 0 with
--       range_from = 990000000). Expected in prod: 0 or a handful of seeded
--       platform/tenant rows. Rows already at or above the floor are untouched.
--   (2) dian_configurations: rows sitting in the impossible state
--       enablement_status = 'testing' with NO test_set_id AND NO certificate go
--       back to 'not_started'. In dev this is exactly 1 row (id 24, the
--       platform documento-soporte stub).
-- Destructive operations: none. No DELETE, no DROP, no TRUNCATE, no CASCADE.
--   Both statements are narrow UPDATEs with a WHERE that only matches invalid
--   states, so re-running them is a no-op.
-- FK/cascade risk: none. No constraint is added, dropped or altered.
-- Idempotency: guaranteed by the WHERE clauses — after the first run no row
--   matches, so a second run updates 0 rows.
-- Approval: requested in chat before applying to production (2026-08-04).
--
-- WHY (1): `InvoiceNumberGenerator` used to do a blind `increment: 1` guarded
-- only by `current_number < range_to`. A resolution whose cursor sat at 0 with
-- range_from = 990000000 therefore allocated invoice number 1 — outside the
-- range the DIAN authorized — and the DIAN rejects every document numbered
-- outside its resolution. The generator now floors the cursor at range_from - 1;
-- this migration repairs the rows that drifted before the fix, so the very first
-- allocation is not a rejected document.
--
-- WHY (2): `enablement_status = 'testing'` asserts a habilitación in progress.
-- A row with no test_set_id and no certificate cannot have one, and that lie
-- makes the platform look mid-habilitación while nothing was ever submitted —
-- and makes the re-poll job consider a batch that does not exist.

-- (1) Restore the authorized floor of any drifted numbering cursor.
UPDATE "invoice_resolutions"
SET "current_number" = "range_from" - 1,
    "updated_at" = NOW()
WHERE "current_number" < "range_from" - 1;

-- (2) Send impossible "testing" DIAN configurations back to "not_started".
UPDATE "dian_configurations"
SET "enablement_status" = 'not_started',
    "updated_at" = NOW()
WHERE "enablement_status" = 'testing'
  AND "test_set_id" IS NULL
  AND "certificate_s3_key" IS NULL;
