-- QUI-648 — Unidades de venta adicionales por producto.
--
-- Separa los dos sentidos que conviven sobre `price_tiers` (tarifa de cliente
-- vs unidad de venta), agrega el margen por presentación y marca la
-- presentación por defecto de cada producto.
--
-- DATA IMPACT:
-- Tables affected: price_tiers, product_price_tier_overrides,
--                  product_price_tier_assignments (solo DDL)
-- Expected row changes: NINGUNO. Migración puramente aditiva — no hay UPDATE,
--   DELETE ni backfill. Las 77 filas de `price_tiers` en producción quedan en
--   `kind = 'customer_tier'` por el DEFAULT, que es exactamente lo que la
--   tabla significaba antes de este enum.
--   Las 8 filas con `units_per_package > 1` (todas en tiendas demo) son
--   conceptualmente `sale_unit` y se reclasifican a mano desde la UI —
--   decisión explícita del usuario para no mutar datos en la migración.
-- Destructive operations: none (sin DROP, sin CASCADE, sin TRUNCATE)
-- FK/cascade risk: none — no se crean ni alteran claves foráneas.
-- Idempotency: guarded by IF NOT EXISTS / DO $$ en cada sentencia.
-- Approval: plan aprobado en chat (8 pasos, commit por paso).

-- 1. Enum del discriminador. Guardado por catálogo para poder re-ejecutar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'price_tier_kind_enum') THEN
    CREATE TYPE "price_tier_kind_enum" AS ENUM ('customer_tier', 'sale_unit');
  END IF;
END $$;

-- 2. `price_tiers.kind` — NOT NULL con default, así toda fila existente queda
--    clasificada como tarifa de cliente sin necesidad de backfill.
ALTER TABLE "price_tiers"
  ADD COLUMN IF NOT EXISTS "kind" "price_tier_kind_enum" NOT NULL DEFAULT 'customer_tier';

-- 3. Margen por presentación. Nullable: una presentación puede definir solo
--    precio, y el margen se deriva del costo × packSize al leerla.
ALTER TABLE "product_price_tier_overrides"
  ADD COLUMN IF NOT EXISTS "override_profit_margin" DECIMAL(5,2);

-- 4. Presentación por defecto del producto.
ALTER TABLE "product_price_tier_assignments"
  ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;

-- 5. Unicidad del default POR PRODUCTO mediante índice único parcial: solo las
--    filas con `is_default = true` participan del índice, así que un producto
--    puede tener N presentaciones habilitadas y a lo sumo UNA por defecto.
--    Un `UNIQUE (product_id, is_default)` no serviría: limitaría también a un
--    único `false` por producto.
--    El índice no puede filtrar además por `kind` (vive en `price_tiers`, otra
--    tabla); que solo un `sale_unit` pueda marcarse lo garantiza el servicio.
CREATE UNIQUE INDEX IF NOT EXISTS "product_price_tier_assignments_one_default_per_product"
  ON "product_price_tier_assignments" ("product_id")
  WHERE "is_default";

-- 6. Índice de lectura para los selectores, que filtran por tienda + eje.
CREATE INDEX IF NOT EXISTS "price_tiers_store_id_kind_is_active_idx"
  ON "price_tiers" ("store_id", "kind", "is_active");
