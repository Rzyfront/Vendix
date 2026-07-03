-- =====================================================
-- M7: seed_puc_236505_labor_withholding
-- =====================================================
-- DATA IMPACT: crea 1 fila por accounting_entity que aún no tenga 236505.
--              Para entidades con 236505 preexistente (parent 1365 "Préstamos
--              a Empleados"), se REASIGNA parent a 2365 (Retenciones) y se
--              RENOMBRA a "Retención en la Fuente - Laboral" para alinear con
--              el uso contable del motor (crédito en aprobación, débito en pago).
--              Idempotente: ON CONFLICT DO NOTHING en el INSERT.
-- =====================================================

-- 1) Reasignar + renombrar 236505 preexistente (parent 1365 → parent 2365)
UPDATE chart_of_accounts c
SET parent_id = (
      SELECT id FROM chart_of_accounts
      WHERE accounting_entity_id = c.accounting_entity_id
        AND code = '2365'
      LIMIT 1
    ),
    name = 'Retención en la Fuente - Laboral'
WHERE c.code = '236505'
  AND c.parent_id IN (
    SELECT id FROM chart_of_accounts WHERE code = '1365'
  );

-- 2) Crear 236505 donde NO exista por (organization_id, code)
--    (unique constraint: chart_of_accounts_org_code_no_entity_uidx)
INSERT INTO chart_of_accounts
  (accounting_entity_id, organization_id, code, name, account_type, level, parent_id, nature, accepts_entries, is_active, created_at)
SELECT
  p.accounting_entity_id,
  p.organization_id,
  '236505',
  'Retención en la Fuente - Laboral',
  'liability',
  4,
  p.id,
  'credit',
  TRUE,
  TRUE,
  CURRENT_TIMESTAMP
FROM chart_of_accounts p
WHERE p.code = '2365'
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts c
    WHERE c.organization_id = p.organization_id
      AND c.code = '236505'
  );