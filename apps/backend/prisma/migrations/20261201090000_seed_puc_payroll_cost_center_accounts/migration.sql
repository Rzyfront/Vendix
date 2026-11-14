-- =====================================================
-- QUI-565: seed_puc_payroll_cost_center_accounts
-- =====================================================
-- DATA IMPACT:
-- Tables affected: chart_of_accounts (INSERT only).
-- Expected row changes: per accounting entity whose chart follows the
--   standard PUC (has 5105) but was seeded with the original 198-account
--   template, create the missing payroll cost-center accounts:
--     class 7 path: 7, 72, 7205, 720530, 720533, 720536, 720539, 720568,
--                   720569, 720570                        (up to 10 rows)
--     sales path:   5205, 520530, 520533, 520536, 520539, 520568, 520569,
--                   520570, 520572                        (up to 9 rows)
--   Entities that already have the full PUC get 0 rows.
-- Destructive operations: none (no UPDATE, no DELETE, existing rows untouched).
-- FK/cascade risk: none; new rows only reference existing parents of the
--   same accounting entity.
-- Idempotency: every INSERT is guarded by NOT EXISTS on
--   (accounting_entity_id, code) plus ON CONFLICT DO NOTHING
--   (chart_of_accounts_entity_code_uidx).
-- Why: payroll default mappings for the operational (7205*) and sales
--   (5205*) cost centers resolve to these codes; without them
--   AccountMappingService.getMappings returns no account_id and the
--   mapping selector renders empty.
-- Source of truth for names/levels: src/common/services/data/colombia-puc.data.ts
-- =====================================================

-- Level 1: class 7 root, only for entities with a standard PUC chart.
INSERT INTO chart_of_accounts
  (organization_id, accounting_entity_id, code, name, account_type, nature,
   parent_id, level, is_active, accepts_entries, created_at, updated_at)
SELECT anchor.organization_id, anchor.accounting_entity_id, '7',
       'Costos de Producción', 'expense'::account_type_enum,
       'debit'::account_nature_enum, NULL, 1, TRUE, FALSE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM chart_of_accounts anchor
WHERE anchor.code = '5105'
  AND anchor.accounting_entity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts c
    WHERE c.accounting_entity_id = anchor.accounting_entity_id
      AND c.code = '7'
  )
ON CONFLICT DO NOTHING;

-- Levels 2-4: each account hangs from its parent in the same entity. Run in
-- parent-first order so every level finds the rows created by the previous one.
-- The 5105 anchor keeps the backfill to standard PUC charts.
INSERT INTO chart_of_accounts
  (organization_id, accounting_entity_id, code, name, account_type, nature,
   parent_id, level, is_active, accepts_entries, created_at, updated_at)
SELECT p.organization_id, p.accounting_entity_id, a.code, a.name,
       'expense'::account_type_enum, 'debit'::account_nature_enum,
       p.id, a.level, TRUE, a.accepts_entries,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('72', 'Mano de Obra Directa', '7', 2, FALSE)
) AS a(code, name, parent_code, level, accepts_entries)
JOIN chart_of_accounts p
  ON p.code = a.parent_code AND p.accounting_entity_id IS NOT NULL
WHERE EXISTS (
    SELECT 1 FROM chart_of_accounts std
    WHERE std.accounting_entity_id = p.accounting_entity_id
      AND std.code = '5105'
  )
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts c
    WHERE c.accounting_entity_id = p.accounting_entity_id
      AND c.code = a.code
  )
ON CONFLICT DO NOTHING;

INSERT INTO chart_of_accounts
  (organization_id, accounting_entity_id, code, name, account_type, nature,
   parent_id, level, is_active, accepts_entries, created_at, updated_at)
SELECT p.organization_id, p.accounting_entity_id, a.code, a.name,
       'expense'::account_type_enum, 'debit'::account_nature_enum,
       p.id, a.level, TRUE, a.accepts_entries,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('7205', 'Mano de Obra Directa', '72', 3, FALSE),
  ('5205', 'Gastos de Personal', '52', 3, FALSE)
) AS a(code, name, parent_code, level, accepts_entries)
JOIN chart_of_accounts p
  ON p.code = a.parent_code AND p.accounting_entity_id IS NOT NULL
WHERE EXISTS (
    SELECT 1 FROM chart_of_accounts std
    WHERE std.accounting_entity_id = p.accounting_entity_id
      AND std.code = '5105'
  )
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts c
    WHERE c.accounting_entity_id = p.accounting_entity_id
      AND c.code = a.code
  )
ON CONFLICT DO NOTHING;

INSERT INTO chart_of_accounts
  (organization_id, accounting_entity_id, code, name, account_type, nature,
   parent_id, level, is_active, accepts_entries, created_at, updated_at)
SELECT p.organization_id, p.accounting_entity_id, a.code, a.name,
       'expense'::account_type_enum, 'debit'::account_nature_enum,
       p.id, a.level, TRUE, a.accepts_entries,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('720530', 'Cesantías', '7205', 4, TRUE),
  ('720533', 'Intereses sobre Cesantías', '7205', 4, TRUE),
  ('720536', 'Prima de Servicios', '7205', 4, TRUE),
  ('720539', 'Vacaciones', '7205', 4, TRUE),
  ('720568', 'Aportes a EPS', '7205', 4, TRUE),
  ('720569', 'Aportes a Pensión', '7205', 4, TRUE),
  ('720570', 'Aportes a ARL', '7205', 4, TRUE),
  ('520530', 'Cesantías', '5205', 4, TRUE),
  ('520533', 'Intereses sobre Cesantías', '5205', 4, TRUE),
  ('520536', 'Prima de Servicios', '5205', 4, TRUE),
  ('520539', 'Vacaciones', '5205', 4, TRUE),
  ('520568', 'Aportes a EPS', '5205', 4, TRUE),
  ('520569', 'Aportes a Pensión', '5205', 4, TRUE),
  ('520570', 'Aportes a ARL', '5205', 4, TRUE),
  ('520572', 'Aportes a Caja de Compensación', '5205', 4, TRUE)
) AS a(code, name, parent_code, level, accepts_entries)
JOIN chart_of_accounts p
  ON p.code = a.parent_code AND p.accounting_entity_id IS NOT NULL
WHERE EXISTS (
    SELECT 1 FROM chart_of_accounts std
    WHERE std.accounting_entity_id = p.accounting_entity_id
      AND std.code = '5105'
  )
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts c
    WHERE c.accounting_entity_id = p.accounting_entity_id
      AND c.code = a.code
  )
ON CONFLICT DO NOTHING;
