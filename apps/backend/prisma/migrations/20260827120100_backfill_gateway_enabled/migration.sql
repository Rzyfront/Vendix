-- DATA IMPACT:
--   - ALTER TABLE: 0 rows (default change only, no existing rows touched).
--   - INSERT: ~N stores × 1 row (dispatch_ticket new format_type per store).
--   - UPDATE: ~N stores × 10 rows (gateway_enabled false→true for existing configs).
--   Idempotent via ON CONFLICT DO NOTHING + WHERE clause.
--   No CASCADE, no TRUNCATE, no DROP. Safe under vendix-prisma-migrations Rule 7.
-- ADR-5: gateway_enabled default true — Enlace Universal ON by default.
-- Pattern §6.2: drop FK child → update → recreate FK. No FK to drop here
-- (gateway_enabled is not referenced by FK), so direct ALTER + INSERT/UPDATE.

BEGIN;

-- 1. Change default for new rows
ALTER TABLE store_print_format_configs
  ALTER COLUMN gateway_enabled SET DEFAULT true;

-- 2. Backfill dispatch_ticket row per store (idempotent)
INSERT INTO store_print_format_configs (store_id, organization_id, format_type, is_active, gateway_enabled, created_at, updated_at)
SELECT s.id, s.organization_id, 'dispatch_ticket', true, true, NOW(), NOW()
FROM stores s
WHERE NOT EXISTS (
  SELECT 1 FROM store_print_format_configs spfc
  WHERE spfc.store_id = s.id AND spfc.format_type = 'dispatch_ticket'
);

-- 3. Enable gateway for existing configs (backfill OFF→ON)
UPDATE store_print_format_configs
SET gateway_enabled = true, updated_at = NOW()
WHERE gateway_enabled = false;

COMMIT;