-- DATA IMPACT:
-- - Tabla: chart_of_accounts
-- - Filas modificadas: 0
-- - Reemplaza el unique legacy (organization_id, code) por dos partial uniques:
--   (accounting_entity_id, code) WHERE accounting_entity_id IS NOT NULL — ya existe (chart_of_accounts_entity_code_uidx)
--   (organization_id, code) WHERE accounting_entity_id IS NULL — nuevo
-- - Sin TRUNCATE, sin DROP TABLE, sin DELETE.

BEGIN;

-- Paso 1: drop legacy unique constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'chart_of_accounts' AND indexname = 'chart_of_accounts_organization_id_code_key'
  ) THEN
    ALTER TABLE chart_of_accounts
      DROP CONSTRAINT IF EXISTS chart_of_accounts_organization_id_code_key;
    -- Por si fue índice sin constraint:
    DROP INDEX IF EXISTS chart_of_accounts_organization_id_code_key;
  END IF;
END $$;

-- Paso 2: partial unique para filas sin accounting_entity_id (caso transitorio del seeder)
CREATE UNIQUE INDEX IF NOT EXISTS chart_of_accounts_org_code_no_entity_uidx
  ON chart_of_accounts (organization_id, code)
  WHERE accounting_entity_id IS NULL;

-- El partial unique (accounting_entity_id, code) WHERE NOT NULL ya existe como chart_of_accounts_entity_code_uidx.

COMMIT;
