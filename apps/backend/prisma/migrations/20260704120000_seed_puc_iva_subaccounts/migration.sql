-- =====================================================
-- seed_puc_iva_subaccounts
-- =====================================================
-- DATA IMPACT:
-- - Tablas afectadas: chart_of_accounts (SOLO INSERT).
-- - Cambios de filas: por CADA fila padre code='2408' (una por accounting_entity
--   + la de organización sin entidad, accounting_entity_id IS NULL) crea las hojas:
--       240802 "IVA Generado por Ventas"        (liability, credit)
--       240804 "IVA Descontable en Compras"     (liability, debit)
--       240810 "IVA por Pagar - Liquidación"    (liability, credit)
--   y por CADA fila padre code='1355' crea la hoja:
--       135520 "Saldo a Favor en IVA"           (asset, debit)
--   Todas nivel 4, accepts_entries=TRUE, is_active heredado del padre.
-- - Conteo esperado: hasta 3 hojas por cada fila 2408 + 1 hoja por cada fila 1355
--   que aún NO las tengan; 0 filas en re-ejecución (idempotente).
-- - Operaciones destructivas: NINGUNA. 0 destructivo, idempotente.
--   Sin TRUNCATE / DROP / DELETE / UPDATE.
-- - FK/cascade risk: ninguno (solo INSERT; parent_id -> chart_of_accounts.id).
-- - Idempotencia: NOT EXISTS scoped por (organization_id, code) con
--   accounting_entity_id IS NOT DISTINCT FROM el del padre → respeta AMBOS
--   partial uniques: chart_of_accounts_entity_code_uidx (accounting_entity_id, code)
--   y chart_of_accounts_org_code_no_entity_uidx (organization_id, code) WHERE
--   accounting_entity_id IS NULL. También backfilla 240802/240804 en tenants
--   antiguos sembrados antes de que estuvieran en el catálogo PUC.
-- - Approval: plan aprobado (F0) documentado en chat.
-- =====================================================

BEGIN;

-- 1) 240802 "IVA Generado por Ventas" (liability, credit) bajo cada 2408
INSERT INTO chart_of_accounts
  (accounting_entity_id, organization_id, code, name, account_type, level, parent_id, nature, accepts_entries, is_active, created_at)
SELECT
  p.accounting_entity_id,
  p.organization_id,
  '240802',
  'IVA Generado por Ventas',
  'liability',
  4,
  p.id,
  'credit',
  TRUE,
  p.is_active,
  CURRENT_TIMESTAMP
FROM chart_of_accounts p
WHERE p.code = '2408'
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts c
    WHERE c.organization_id = p.organization_id
      AND c.code = '240802'
      AND c.accounting_entity_id IS NOT DISTINCT FROM p.accounting_entity_id
  );

-- 2) 240804 "IVA Descontable en Compras" (liability, debit) bajo cada 2408
INSERT INTO chart_of_accounts
  (accounting_entity_id, organization_id, code, name, account_type, level, parent_id, nature, accepts_entries, is_active, created_at)
SELECT
  p.accounting_entity_id,
  p.organization_id,
  '240804',
  'IVA Descontable en Compras',
  'liability',
  4,
  p.id,
  'debit',
  TRUE,
  p.is_active,
  CURRENT_TIMESTAMP
FROM chart_of_accounts p
WHERE p.code = '2408'
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts c
    WHERE c.organization_id = p.organization_id
      AND c.code = '240804'
      AND c.accounting_entity_id IS NOT DISTINCT FROM p.accounting_entity_id
  );

-- 3) 240810 "IVA por Pagar - Liquidación" (liability, credit) bajo cada 2408
INSERT INTO chart_of_accounts
  (accounting_entity_id, organization_id, code, name, account_type, level, parent_id, nature, accepts_entries, is_active, created_at)
SELECT
  p.accounting_entity_id,
  p.organization_id,
  '240810',
  'IVA por Pagar - Liquidación',
  'liability',
  4,
  p.id,
  'credit',
  TRUE,
  p.is_active,
  CURRENT_TIMESTAMP
FROM chart_of_accounts p
WHERE p.code = '2408'
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts c
    WHERE c.organization_id = p.organization_id
      AND c.code = '240810'
      AND c.accounting_entity_id IS NOT DISTINCT FROM p.accounting_entity_id
  );

-- 4) 135520 "Saldo a Favor en IVA" (asset, debit) bajo cada 1355
INSERT INTO chart_of_accounts
  (accounting_entity_id, organization_id, code, name, account_type, level, parent_id, nature, accepts_entries, is_active, created_at)
SELECT
  p.accounting_entity_id,
  p.organization_id,
  '135520',
  'Saldo a Favor en IVA',
  'asset',
  4,
  p.id,
  'debit',
  TRUE,
  p.is_active,
  CURRENT_TIMESTAMP
FROM chart_of_accounts p
WHERE p.code = '1355'
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts c
    WHERE c.organization_id = p.organization_id
      AND c.code = '135520'
      AND c.accounting_entity_id IS NOT DISTINCT FROM p.accounting_entity_id
  );

COMMIT;
