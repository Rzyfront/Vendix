-- =====================================================
-- A.1 CP-impuesto-incluido-agregado: is_inclusive en
-- product_tax_assignments y order_item_taxes (+ backfill)
-- =====================================================
-- DATA IMPACT:
-- Tables affected: product_tax_assignments, order_item_taxes
-- Columns added (2):
--   - product_tax_assignments.is_inclusive  BOOLEAN NOT NULL DEFAULT FALSE
--   - order_item_taxes.is_inclusive         BOOLEAN NOT NULL DEFAULT FALSE
-- Expected row changes: backfill SOLO en product_tax_assignments con scope
--   coincidente (guarda tenant-scoped F-033 abajo); order_item_taxes queda en
--   FALSE para todo el historico (impuesto AGREGADO = comportamiento actual,
--   cero cambio de totales). Historico sin catalogo inclusivo queda `false`.
-- Destructive operations: none (solo ADD COLUMN IF NOT EXISTS + UPDATE con
--   WHERE; sin DELETE / TRUNCATE / DROP / CASCADE)
-- FK/cascade risk: none (sin cambios de FK; el backfill solo LEE
--   tax_categories / tax_rates / products / stores)
-- Idempotency: ADD COLUMN IF NOT EXISTS; UPDATE con WHERE re-ejecutable
--   (fija TRUE donde el default canonico es TRUE)
-- Approval: plan docs/critical-plans/CP-impuesto-incluido-agregado/steps/
--   A.1-impuesto-incluido-agregado.md (+ findings F-012, F-033)
--
-- Precedencia canonica (F-012): tax_categories.is_inclusive
--   ?? primera tax_rates.is_inclusive de la categoria (ORDER BY id)
--   ?? FALSE. La asignacion gana (ADR-01); el flag de tasa es legacy.
-- =====================================================

ALTER TABLE "product_tax_assignments" ADD COLUMN IF NOT EXISTS "is_inclusive" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "order_item_taxes" ADD COLUMN IF NOT EXISTS "is_inclusive" BOOLEAN NOT NULL DEFAULT FALSE;

-- -----------------------------------------------------
-- F-033 · Caza-huerfanos (BLOQUEADOR): asignaciones cuyo scope de categoria
-- NO coincide con el scope del producto:
--   - categoria de tienda => tc.store_id debe ser p.store_id
--   - categoria de org    => tc.organization_id debe ser la org del store
--   - categoria global (ambos NULL) => coincide con todo
-- Si COUNT > 0 la migracion ABORTA (RAISE EXCEPTION) y NO aplica el backfill:
-- resolver el cruce legacy a mano antes de reintentar.
-- Verificacion manual (solo lectura):
--   SELECT pta.product_id, pta.tax_category_id, p.store_id AS product_store,
--     tc.store_id AS category_store, tc.organization_id AS category_org,
--     s.organization_id AS product_org
--   FROM "product_tax_assignments" pta
--   JOIN "products" p ON p.id = pta.product_id
--   JOIN "stores" s ON s.id = p.store_id
--   JOIN "tax_categories" tc ON tc.id = pta.tax_category_id
--   WHERE NOT (
--     (tc.store_id IS NOT NULL AND tc.store_id = p.store_id)
--     OR (tc.store_id IS NULL AND tc.organization_id IS NOT NULL
--         AND tc.organization_id = s.organization_id)
--     OR (tc.store_id IS NULL AND tc.organization_id IS NULL)
--   );
-- -----------------------------------------------------
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM "product_tax_assignments" pta
  JOIN "products" p ON p.id = pta.product_id
  JOIN "stores" s ON s.id = p.store_id
  JOIN "tax_categories" tc ON tc.id = pta.tax_category_id
  WHERE NOT (
    (tc.store_id IS NOT NULL AND tc.store_id = p.store_id)
    OR (tc.store_id IS NULL AND tc.organization_id IS NOT NULL
        AND tc.organization_id = s.organization_id)
    OR (tc.store_id IS NULL AND tc.organization_id IS NULL)
  );

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'F-033 BLOQUEADOR: % asignacion(es) con scope cruzado (categoria de otra tienda/org). Resolver a mano y reintentar; backfill NO aplicado.', orphan_count;
  END IF;
END $$;

-- -----------------------------------------------------
-- Backfill tenant-scoped (F-033): solo filas con scope coincidente heredan
-- el default canonico (F-012). UPDATE con WHERE (obligatorio). Los joins van
-- en el WHERE (no JOIN...ON): Postgres no permite referenciar el alias del
-- target del UPDATE dentro del ON del FROM.
-- -----------------------------------------------------
UPDATE "product_tax_assignments" AS pta
SET "is_inclusive" = TRUE
FROM "products" AS p, "stores" AS s, "tax_categories" AS tc
WHERE pta.product_id = p.id
  AND s.id = p.store_id
  AND tc.id = pta.tax_category_id
  AND (
    (tc.store_id IS NOT NULL AND tc.store_id = p.store_id)
    OR (tc.store_id IS NULL AND tc.organization_id IS NOT NULL
        AND tc.organization_id = s.organization_id)
    OR (tc.store_id IS NULL AND tc.organization_id IS NULL)
  )
  AND COALESCE(
    tc.is_inclusive,
    (SELECT r.is_inclusive
     FROM "tax_rates" AS r
     WHERE r.tax_category_id = tc.id
     ORDER BY r.id ASC
     LIMIT 1),
    FALSE
  ) IS TRUE;

-- -----------------------------------------------------
-- Reconciliacion de divergencias categoria-vs-tasa (F-012, verificable):
-- filas donde el flag de categoria difiere del primer flag de tasa. Un conteo
-- > 0 NO bloquea (la categoria gana por precedencia), pero debe revisarse
-- porque el frontend usara el mismo canon categoria??tasa??false.
--   SELECT tc.id, tc.name, tc.store_id, tc.organization_id,
--     tc.is_inclusive AS category_flag,
--     (SELECT r.is_inclusive FROM "tax_rates" r
--       WHERE r.tax_category_id = tc.id ORDER BY r.id ASC LIMIT 1
--     ) AS first_rate_flag
--   FROM "tax_categories" tc
--   WHERE tc.is_inclusive IS DISTINCT FROM (
--     SELECT r.is_inclusive FROM "tax_rates" r
--       WHERE r.tax_category_id = tc.id ORDER BY r.id ASC LIMIT 1
--   );
--
-- Conteo de verificacion del backfill (A.1):
--   SELECT COUNT(*) FROM "product_tax_assignments" WHERE "is_inclusive" IS TRUE;
-- debe igualar el conteo de asignaciones con scope coincidente cuyo default
-- canonico es TRUE (evidencia en evidence/A.1-backfill-count.txt).
-- -----------------------------------------------------
