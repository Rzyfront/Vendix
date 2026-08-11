-- DATA IMPACT:
-- Tables affected: cash_registers (INSERT only)
-- Expected row changes: +1 row per store that owns ZERO cash registers.
--   Measured on dev before writing this migration: 21 stores, 19 without a
--   register, 3 registers total. Production count will differ; the guard makes
--   the statement safe regardless of how many rows it touches.
-- Destructive operations: none. No DELETE, no UPDATE, no TRUNCATE, no DROP,
--   no CASCADE. Nothing pre-existing is read-modified-written.
-- FK/cascade risk: none. cash_registers.store_id -> stores(id) is the only FK
--   involved and it is the parent side; no inbound FK of cash_registers
--   (cash_register_sessions) is touched, so no cascade can fire.
-- Idempotency: guarded by `NOT EXISTS (... WHERE c.store_id = s.id)`, so a
--   second run inserts nothing. `ON CONFLICT (store_id, code) DO NOTHING`
--   is a second belt against a concurrent insert of the same code.
-- Approval: QUI-654 — requested by the user, who asked for all 7 tickets to be
--   implemented. The ticket text itself mandates this backfill.
--
-- WHY
-- ===
-- Creating a store never created a cash register. `cash_registers.create`
-- existed only in the module CRUD (cash-registers.service.ts) and no store
-- creation path invoked it, so the first person who tried to charge in a new
-- store found an empty register list and had to configure one before selling.
--
-- The code change makes NEW stores be born with a register, across all three
-- creation paths (organization, onboarding wizard, superadmin). This migration
-- covers the stores that already exist.
--
-- The register is created inactive-safe: `is_active = true` so it is
-- immediately usable, and `location_id = NULL` on purpose — the POS resolves
-- its sale location from `stores.default_location_id`, and pinning the
-- register to a location here would override that cascade.
--
-- `code` must match `DEFAULT_CASH_REGISTER.code` in
-- `apps/backend/src/common/helpers/store-bootstrap.helper.ts`, because the
-- unique constraint `@@unique([store_id, code])` is what makes both the
-- application path and this backfill converge on the same row.

INSERT INTO "cash_registers" (
  "store_id",
  "name",
  "code",
  "description",
  "is_active",
  "location_id",
  "created_at",
  "updated_at"
)
SELECT
  s."id",
  'Caja principal',
  'PRINCIPAL',
  'Caja creada automaticamente para que la tienda pueda cobrar sin configuracion previa.',
  true,
  NULL,
  NOW(),
  NOW()
FROM "stores" s
WHERE NOT EXISTS (
  SELECT 1 FROM "cash_registers" c WHERE c."store_id" = s."id"
)
ON CONFLICT ("store_id", "code") DO NOTHING;
