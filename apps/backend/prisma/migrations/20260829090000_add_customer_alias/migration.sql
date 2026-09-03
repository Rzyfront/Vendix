-- =====================================================================
-- Migration: add_customer_alias (CP-POLLO-ARABE-727 A.3 / ADR-9)
-- Purpose: Añadir `orders.customer_alias` (venta anónima/física sin cliente
--          registrado) y el CHECK de exclusión mutua con `customer_id`.
-- =====================================================================
--
-- DATA IMPACT:
--   Tables affected: orders (schema-only)
--   Rows mutated:    NONE (additive + nullable)
--   Destructive operations: none
--   FK/cascade risk: none (customer_alias es scalar, sin FK)
--   Idempotency: ADD COLUMN IF NOT EXISTS + ADD CONSTRAINT guardado con
--                EXCEPTION WHEN duplicate_object
--   Approval: CP-POLLO-ARABE-727 A.3 (auditoría de write sites hecha; ver
--             reporte — el CHECK es la 2ª defensa tras el guard de código)
-- =====================================================================

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_alias" varchar(100);

-- ---------------------------------------------------------------------
-- ADR-9: customer_id y customer_alias son mutuamente excluyentes.
--   - customer_id set  + customer_alias NULL -> cliente registrado
--   - customer_id NULL + customer_alias set  -> venta con alias
--   - ambos NULL                              -> anónimo
--   - ambos set                               -> VIOLACION (500: el guard de
--     código en orders.service.ts / payments.service.ts /
--     table-sessions.service.ts es la 1ª defensa para no llegar al constraint)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_customer_xor_alias"
      CHECK ("customer_id" IS NULL OR "customer_alias" IS NULL);
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END
$$;
