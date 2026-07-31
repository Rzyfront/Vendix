-- DATA IMPACT:
-- Tables affected: suppliers
-- Expected row changes: backfill de `state` en todas las filas existentes
--   (is_active = true  -> 'active'; is_active = false -> 'inactive').
--   Ninguna fila se borra ni se pierde. `is_active` se conserva intacta:
--   su DROP va en una migración posterior con snapshot y autorización explícita.
-- Destructive operations: none
-- FK/cascade risk: none — no se toca ninguna FK entrante a suppliers
--   (purchase_orders, accounts_payable, invoices, withholding_calculations,
--   dispatch_notes, dispatch_routes, shipping_methods, supplier_products).
--   Archivar es un cambio de estado, no un DELETE, así que todas siguen resolviendo.
-- Idempotency: CREATE TYPE guardado por pg_type, ADD COLUMN con IF NOT EXISTS,
--   UPDATE con WHERE que solo alcanza filas aún en el default.
-- Approval: aprobado en chat — plan docs/plans/suppliers-estado-tri-valor-archivado.md

-- 1. Enum de ciclo de vida, alineado con brand_state_enum / category_state_enum /
--    product_state_enum. Guardado por catálogo para ser reejecutable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'supplier_state_enum') THEN
    CREATE TYPE "supplier_state_enum" AS ENUM ('active', 'inactive', 'archived');
  END IF;
END $$;

-- 2. Columna nueva con default 'active' para que las filas existentes queden
--    válidas antes del backfill.
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "state" "supplier_state_enum" NOT NULL DEFAULT 'active';

-- 3. Backfill desde is_active. El WHERE evita reescribir filas ya migradas si la
--    migración se reejecuta, y acota el UPDATE (prohibido un UPDATE sin WHERE).
UPDATE "suppliers"
   SET "state" = 'inactive'
 WHERE "is_active" = false
   AND "state" = 'active';
