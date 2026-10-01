-- DATA IMPACT:
-- Tables affected: received_document_taxes, fiscal_obligations.
-- Expected existing row changes: none. Adds one nullable JSONB column, allows
--   unknown due dates, and replaces only the obligation uniqueness index.
-- Destructive operations: no table/column/data deletion or cascade; one obsolete
--   unique index is dropped after its range+jurisdiction replacement is created.
-- FK/cascade risk: none.
-- Idempotency: guarded ADD COLUMN/CHECK, nullable DROP NOT NULL, duplicate-key
--   preflight, CREATE UNIQUE INDEX IF NOT EXISTS, and DROP INDEX IF EXISTS.
-- Eligibility CHECK: the eligible tax basis cannot exceed the source tax amount.

ALTER TABLE "received_document_taxes"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

ALTER TABLE "fiscal_obligations"
  ALTER COLUMN "due_date" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'received_doc_taxes_eligible_lte_amount_check'
  ) THEN
    ALTER TABLE "received_document_taxes"
      ADD CONSTRAINT "received_doc_taxes_eligible_lte_amount_check"
      CHECK ("eligible_amount" <= "amount");
  END IF;
END $$;

-- The old unique key used calendar year/month/quarter, which is ambiguous for
-- overlapping or non-calendar tax periods and cannot distinguish jurisdiction.
-- Refuse to discard its protection if existing rows collide under the new key;
-- remediation must be explicit and audited rather than silently deleting data.
DO $$
DECLARE
  duplicate_keys TEXT;
BEGIN
  SELECT string_agg(
    format(
      '(entity=%s, type=%s, period_start=%s, period_end=%s, jurisdiction=%s, rows=%s)',
      duplicate.accounting_entity_id,
      duplicate."type",
      duplicate.period_start,
      duplicate.period_end,
      duplicate.jurisdiction_key,
      duplicate.row_count
    ),
    E'\n'
  )
  INTO duplicate_keys
  FROM (
    SELECT
      "accounting_entity_id",
      "type",
      "period_start",
      "period_end",
      "jurisdiction_key",
      COUNT(*) AS row_count
    FROM "fiscal_obligations"
    GROUP BY
      "accounting_entity_id",
      "type",
      "period_start",
      "period_end",
      "jurisdiction_key"
    HAVING COUNT(*) > 1
  ) AS duplicate;

  IF duplicate_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot replace fiscal obligation uniqueness: duplicate entity/type/date-range/jurisdiction keys exist:%',
      E'\n' || duplicate_keys;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_obligations_entity_type_range_jurisdiction_key"
  ON "fiscal_obligations" (
    "accounting_entity_id",
    "type",
    "period_start",
    "period_end",
    "jurisdiction_key"
  );

DROP INDEX IF EXISTS "fiscal_obligations_entity_type_period_key";
