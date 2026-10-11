-- DATA IMPACT:
-- Tables affected: quotations
-- Expected row changes: zero; all historical anchors remain NULL
-- Destructive operations: none
-- FK/cascade risk: composite RESTRICT protects the quoted invoice-profile version from deletion
-- Idempotency: columns/index/constraints are catalog-guarded
-- Approval: additive P1.2 quote-profile version anchor; no backfill requested

ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "invoice_profile_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "invoice_profile_version" INTEGER;

CREATE INDEX IF NOT EXISTS "quotations_invoice_profile_id_invoice_profile_version_idx"
  ON "quotations"("invoice_profile_id", "invoice_profile_version");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotations_invoice_profile_id_invoice_profile_version_fkey'
      AND conrelid = 'quotations'::regclass
  ) THEN
    ALTER TABLE "quotations"
      ADD CONSTRAINT "quotations_invoice_profile_id_invoice_profile_version_fkey"
      FOREIGN KEY ("invoice_profile_id", "invoice_profile_version")
      REFERENCES "invoice_profile_versions"("profile_id", "version")
      ON DELETE RESTRICT
      ON UPDATE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotations_invoice_profile_anchor_both_or_none_check'
      AND conrelid = 'quotations'::regclass
  ) THEN
    ALTER TABLE "quotations"
      ADD CONSTRAINT "quotations_invoice_profile_anchor_both_or_none_check"
      CHECK (
        ("invoice_profile_id" IS NULL AND "invoice_profile_version" IS NULL)
        OR
        ("invoice_profile_id" IS NOT NULL AND "invoice_profile_version" IS NOT NULL)
      );
  END IF;
END $$;
