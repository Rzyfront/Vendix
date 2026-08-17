-- =============================================================================
-- Bug 12 — order_items UoM snapshot for sale display
-- -----------------------------------------------------------------------------
-- Tables affected (schema-only, no row deletes / no truncates):
--   * order_items   -> ADD COLUMN sale_unit_code_snapshot VARCHAR(20) NULL
--                     ADD COLUMN sale_quantity_snapshot DECIMAL(18,6) NULL
--
-- Why:
--   Cuando un producto tiene unidad de medida (UoM) para ventas, el carrito
--   y el ticket deben mostrar "1 × 250 g" en vez de "1 × und". El snapshot
--   guarda la unidad ('kg', 'und', 'L', ...) y la cantidad en esa unidad
--   (250, 1, 0.5, ...) al momento del cobro, para que el ticket y los
--   reportes históricos NO dependan de cambios futuros en
--   products.units_per_package.
--
--   Es consistente con el patrón existente: order_items ya tiene
--   applied_price_tier_id + applied_price_tier_name_snapshot (Phase 1 de
--   price tiers), y sale_unit_code_snapshot es análogo.
--
-- Existing rows preserved:
--   * No row deletes / no truncates / no unscoped updates.
--   * Las 2 columnas son nullable → todas las líneas existentes quedan
--     con snapshot NULL (legacy: el frontend cae al fallback "und").
-- =============================================================================

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "sale_unit_code_snapshot" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "sale_quantity_snapshot" DECIMAL(18, 6);
