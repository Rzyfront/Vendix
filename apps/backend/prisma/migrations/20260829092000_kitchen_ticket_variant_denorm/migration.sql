-- =====================================================================
-- Migration: kitchen_ticket_variant_denorm (CP-POLLO-ARABE-727 A.3)
-- Purpose: Denormalizar la variante en el ticket de cocina:
--          `kitchen_ticket_items.product_variant_id` (FK SET NULL) y
--          `variant_label` (snapshot inmutable al fire).
-- =====================================================================
--
-- DATA IMPACT:
--   Tables affected: kitchen_ticket_items (schema-only)
--   Rows mutated:    NONE (additive + nullable)
--   Destructive operations: none
--   FK/cascade risk: product_variant_id -> product_variants(id) ON DELETE
--                    SET NULL (si la variante se borra, el ítem conserva
--                    variant_label como snapshot)
--   Idempotency: ADD COLUMN IF NOT EXISTS × 2 + ADD CONSTRAINT guardado con
--                EXCEPTION WHEN duplicate_object
--   Approval: CP-POLLO-ARABE-727 A.3
-- =====================================================================
--
-- ★ Decisión de oleada 5 (verificada): NO se crea el índice parcial sobre
--   product_variant_id. Hoy NINGUNA consulta del plan lo usaría:
--   - La única lectura filtrada de kitchen_ticket_items es
--     kitchen-fire.service.ts:1718 `findMany({ where: { kitchen_ticket_id } })`.
--   - La verificación DB-06 hace JOIN por order_item_id, que ya tiene índice.
--   Un índice sin lector solo cuesta escrituras en una tabla de alto volumen.
--   Si un step futuro declara una query por product_variant_id, se agrega ahí.

ALTER TABLE "kitchen_ticket_items" ADD COLUMN IF NOT EXISTS "product_variant_id" integer;
ALTER TABLE "kitchen_ticket_items" ADD COLUMN IF NOT EXISTS "variant_label" varchar(120);

DO $$
BEGIN
  BEGIN
    ALTER TABLE "kitchen_ticket_items"
      ADD CONSTRAINT "kitchen_ticket_items_product_variant_id_fkey"
      FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END
$$;
