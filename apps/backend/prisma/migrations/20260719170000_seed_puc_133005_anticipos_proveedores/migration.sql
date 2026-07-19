-- =====================================================
-- seed_puc_133005_anticipos_proveedores
-- =====================================================
-- DATA IMPACT:
-- - Tablas afectadas: chart_of_accounts (SOLO INSERT).
-- - Cambios de filas: por CADA fila padre code='1330' ("Anticipos y Avances",
--   una por accounting_entity + la de organización sin entidad,
--   accounting_entity_id IS NULL) crea la hoja:
--       133005 "A Proveedores"  (asset, debit, nivel 4, accepts_entries=TRUE)
--   is_active heredado del padre.
--   Semántica PUC: "Anticipos a proveedores" (grupo 1330 "Anticipos y Avances").
--   El nombre 'A Proveedores' se alinea DELIBERADAMENTE con el catálogo canónico
--   (colombia-puc.data.ts) para que un re-run del seed default-puc NO revierta
--   el nombre (evita drift seed<->migración).
-- - Conteo esperado: hasta 1 hoja por cada fila 1330 que aún NO la tenga; 0 filas
--   en re-ejecución (idempotente). Backfillea tenants sembrados ANTES de que 133005
--   entrara al catálogo PUC (commit 30461d6a7, 2026-05-11).
-- - Operaciones destructivas: NINGUNA. 0 destructivo, idempotente.
--   Sin TRUNCATE / DROP / DELETE / UPDATE / CASCADE.
-- - FK/cascade risk: ninguno (solo INSERT; parent_id -> chart_of_accounts.id).
-- - Idempotencia: NOT EXISTS scoped por (organization_id, code) con
--   accounting_entity_id IS NOT DISTINCT FROM el del padre → respeta AMBOS
--   partial uniques: chart_of_accounts_entity_code_uidx (accounting_entity_id, code)
--   y chart_of_accounts_org_code_no_entity_uidx (organization_id, code) WHERE
--   accounting_entity_id IS NULL.
-- - Approval: plan aprobado (F0) documentado en chat/prompt del orquestador.
-- - Patrón: réplica de 20260704120000_seed_puc_iva_subaccounts.
-- =====================================================

BEGIN;

-- 133005 "A Proveedores" (asset, debit) bajo cada 1330 "Anticipos y Avances"
INSERT INTO chart_of_accounts
  (accounting_entity_id, organization_id, code, name, account_type, level, parent_id, nature, accepts_entries, is_active, created_at)
SELECT
  p.accounting_entity_id,
  p.organization_id,
  '133005',
  'A Proveedores',
  'asset',
  4,
  p.id,
  'debit',
  TRUE,
  p.is_active,
  CURRENT_TIMESTAMP
FROM chart_of_accounts p
WHERE p.code = '1330'
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts c
    WHERE c.organization_id = p.organization_id
      AND c.code = '133005'
      AND c.accounting_entity_id IS NOT DISTINCT FROM p.accounting_entity_id
  );

COMMIT;
