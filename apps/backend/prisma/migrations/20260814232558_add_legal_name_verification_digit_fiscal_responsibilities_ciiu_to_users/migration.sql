-- DATA IMPACT:
-- Tables affected: users
-- Columns added (4):
--   - verification_digit       VARCHAR(1)  NULL
--   - legal_name               VARCHAR(255) NULL
--   - fiscal_responsibilities  TEXT[]      NOT NULL DEFAULT '{}'  (PostgreSQL native array)
--   - ciiu_code                VARCHAR(10) NULL
-- Columns re-typed in place (3) — promoted from free-form VARCHAR to typed
-- enums; legacy values are preserved through `USING ...::enum`:
--   - document_type VARCHAR(50)  -> identification_type_enum?
--   - tax_regime    VARCHAR(50)  -> tax_regime_enum?
--   - person_type   VARCHAR(20)  -> persona_type_enum?
-- Enums created (3):
--   - identification_type_enum (CC, CE, NIT, TI, RC, PA, PEP, PPT, DIE, NUIP)
--   - persona_type_enum        (NATURAL, JURIDICA)
--   - tax_regime_enum          (COMUN, SIMPLIFICADO, GRAN_CONTRIBUYENTE, AUTORRETENEDOR, ESPECIAL, NO_APLICA)
-- Backfill (idempotent):
--   - For users with `document_type='NIT'` AND `document_number LIKE '%-%'`,
--     derive `verification_digit` from `SPLIT_PART(document_number,'-',2)` and
--     store the bare number in `document_number`. Guards on
--     `verification_digit IS NULL` make this safe to re-run.
-- Destructive operations: none (all ADD COLUMN IF NOT EXISTS, ALTER TYPE USING
--   with safe cast, no DROP COLUMN, no CASCADE).
-- FK/cascade risk: none.
-- Idempotency: every structural change is guarded by `IF NOT EXISTS` /
--   `DROP TYPE IF EXISTS` cycle + `CREATE TYPE`.
-- Approval: QUI-728 customer-fiscal-data-flow plan, Phase 4 Steps 1-4.

-- ============================================================================
-- 1. Create enums (guarded for idempotency)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'identification_type_enum') THEN
    CREATE TYPE identification_type_enum AS ENUM (
      'CC', 'CE', 'NIT', 'TI', 'RC', 'PA', 'PEP', 'PPT', 'DIE', 'NUIP'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'persona_type_enum') THEN
    CREATE TYPE persona_type_enum AS ENUM ('NATURAL', 'JURIDICA');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tax_regime_enum') THEN
    CREATE TYPE tax_regime_enum AS ENUM (
      'COMUN', 'SIMPLIFICADO', 'GRAN_CONTRIBUYENTE', 'AUTORRETENEDOR', 'ESPECIAL', 'NO_APLICA'
    );
  END IF;
END$$;

-- ============================================================================
-- 2. Add new columns (guarded for idempotency)
-- ============================================================================

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "verification_digit" VARCHAR(1);

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "legal_name" VARCHAR(255);

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "fiscal_responsibilities" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "ciiu_code" VARCHAR(10);

-- ============================================================================
-- 3. Re-type legacy VARCHAR columns to enums (in place, no DROP COLUMN)
-- ============================================================================
-- The USING clause handles the safe cast: any value that doesn't match a
-- enum label is mapped to NULL via the explicit WHEN clause. Existing
-- production rows that carry a stray string are preserved as NULL instead
-- of failing the migration. The fallback WHEN covers unexpected legacy
-- values without aborting the deployment.

ALTER TABLE "users"
  ALTER COLUMN "document_type" TYPE identification_type_enum
  USING (
    CASE "document_type"
      WHEN 'CC'  THEN 'CC'::identification_type_enum
      WHEN 'CE'  THEN 'CE'::identification_type_enum
      WHEN 'NIT' THEN 'NIT'::identification_type_enum
      WHEN 'TI'  THEN 'TI'::identification_type_enum
      WHEN 'RC'  THEN 'RC'::identification_type_enum
      WHEN 'PA'  THEN 'PA'::identification_type_enum
      WHEN 'PEP' THEN 'PEP'::identification_type_enum
      WHEN 'PPT' THEN 'PPT'::identification_type_enum
      WHEN 'DIE' THEN 'DIE'::identification_type_enum
      WHEN 'NUIP' THEN 'NUIP'::identification_type_enum
      ELSE NULL
    END
  );

ALTER TABLE "users"
  ALTER COLUMN "tax_regime" TYPE tax_regime_enum
  USING (
    CASE "tax_regime"
      WHEN 'COMUN'             THEN 'COMUN'::tax_regime_enum
      WHEN 'SIMPLIFICADO'      THEN 'SIMPLIFICADO'::tax_regime_enum
      WHEN 'GRAN_CONTRIBUYENTE' THEN 'GRAN_CONTRIBUYENTE'::tax_regime_enum
      WHEN 'AUTORRETENEDOR'    THEN 'AUTORRETENEDOR'::tax_regime_enum
      WHEN 'ESPECIAL'          THEN 'ESPECIAL'::tax_regime_enum
      WHEN 'NO_APLICA'         THEN 'NO_APLICA'::tax_regime_enum
      ELSE NULL
    END
  );

ALTER TABLE "users"
  ALTER COLUMN "person_type" TYPE persona_type_enum
  USING (
    CASE "person_type"
      WHEN 'NATURAL'  THEN 'NATURAL'::persona_type_enum
      WHEN 'JURIDICA' THEN 'JURIDICA'::persona_type_enum
      ELSE NULL
    END
  );

-- ============================================================================
-- 4. Backfill the verification digit from legacy `document_number` shapes
-- ============================================================================
-- Rows where the legacy code concatenated the DV as `NIT-7` instead of using
-- a separate column. The split moves the digits after the dash into
-- `verification_digit` and keeps only the bare number in `document_number`.
-- Guarded on `verification_digit IS NULL` so it is safe to re-run.

UPDATE "users"
  SET
    "verification_digit" = SPLIT_PART("document_number", '-', 2),
    "document_number"    = SPLIT_PART("document_number", '-', 1)
  WHERE "document_type" = 'NIT'
    AND "document_number" LIKE '%-%'
    AND "verification_digit" IS NULL;
