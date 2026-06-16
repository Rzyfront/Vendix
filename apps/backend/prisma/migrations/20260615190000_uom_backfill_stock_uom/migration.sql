-- =====================================================================
-- UoM backfill for restaurant ingredients (Fase UoM — B.7)
-- =====================================================================
-- Forward-only corrective migration. The prior migration
-- (20260615182141_uom_exact_control) created the global units_of_measure
-- catalog and the additive products.stock_uom_id / products.purchase_uom_id
-- FKs, but left them NULL on pre-existing ingredients. Many of those
-- ingredients still carry the legacy string columns products.stock_unit /
-- products.purchase_unit (e.g. 'g', 'ml', 'L', 'kg'). This migration maps
-- those legacy strings onto the new catalog FKs, only when the match is exact.
--
-- Do NOT edit 20260615182141 in place (it is already applied in dev and would
-- break its checksum -> P3009 on staging/prod). This is a NEW migration.
-- =====================================================================
-- DATA IMPACT:
-- Tables affected:
--   - products  (UPDATE of stock_uom_id / purchase_uom_id, restricted to rows
--                where is_ingredient = true, the legacy string column is set
--                and maps exactly to a units_of_measure.code, and the FK is
--                currently NULL)
-- Expected row changes: variable — only ingredients whose legacy
--   stock_unit / purchase_unit string matches an existing UoM `code` exactly
--   (case-insensitive, trimmed). Ingredients without a recognizable unit, or
--   whose FK is already populated, are left untouched.
-- Destructive operations: none.
--   - No DROP / TRUNCATE / DELETE. Pure scoped UPDATE that only fills NULLs.
--   - Legacy string columns (stock_unit / purchase_unit) are NOT modified.
-- FK/cascade risk: none. Both FKs already exist (ON DELETE SET NULL); this
--   migration only assigns valid catalog ids that satisfy them.
-- Idempotency: guarded.
--   - Each UPDATE requires the target FK to be NULL (... IS NULL) and an exact
--     match against units_of_measure.code, so re-running is a no-op after the
--     first successful apply (no rows remain that satisfy the WHERE).
-- Approval: documented in plan (Control exacto de UoM, gap B.7 — backfill).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Backfill products.stock_uom_id from the legacy stock_unit string.
--    Scoped to ingredients with a NULL FK and an exact catalog match.
-- ---------------------------------------------------------------------
UPDATE "products" p
SET "stock_uom_id" = u."id"
FROM "units_of_measure" u
WHERE p."is_ingredient" = true
  AND p."stock_uom_id" IS NULL
  AND p."stock_unit" IS NOT NULL
  AND lower(trim(p."stock_unit")) = lower(u."code");

-- ---------------------------------------------------------------------
-- 2) Backfill products.purchase_uom_id from the legacy purchase_unit string.
--    Same scoping and exact-match guard.
-- ---------------------------------------------------------------------
UPDATE "products" p
SET "purchase_uom_id" = u."id"
FROM "units_of_measure" u
WHERE p."is_ingredient" = true
  AND p."purchase_uom_id" IS NULL
  AND p."purchase_unit" IS NOT NULL
  AND lower(trim(p."purchase_unit")) = lower(u."code");
