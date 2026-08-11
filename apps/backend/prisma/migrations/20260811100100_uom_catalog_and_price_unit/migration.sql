-- DATA IMPACT:
-- Tables affected:
--   units_of_measure  → +1 columna (is_stock_eligible), +21 filas sembradas,
--                       UPDATE de is_stock_eligible=false sobre 'mg' (1 fila preexistente)
--   products          → +1 columna (price_unit_quantity, default 1)
--   order_items, sales_order_items, quotation_items, invoice_items
--                     → +1 columna nullable (price_unit_quantity)
--   refund_items      → +1 columna nullable (stock_units_consumed)
-- Expected row changes: 1 UPDATE (units_of_measure.code='mg'), 0 filas de negocio tocadas.
--   Ningún producto cambia de precio: price_unit_quantity entra con DEFAULT 1,
--   que reproduce exactamente la aritmética histórica (total = unit_price * quantity).
-- Destructive operations: none — sin DROP, sin CASCADE, sin DELETE.
-- FK/cascade risk: none — no se crean ni modifican FKs.
-- Idempotency: ADD COLUMN IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING +
--   UPDATE acotado por WHERE sobre códigos de catálogo global.
-- Approval: QUI-648 fase 2, paso 2 — plan aprobado en chat.
-- Medición previa (producción, 2026-08-11): 3.788 productos 'unit' y 1 'weight';
--   15 productos con stock_uom; 0 líneas con stock_units_consumed.

-- ---------------------------------------------------------------------
-- 1) units_of_measure.is_stock_eligible
--    El inventario es Int en la unidad base: una unidad con factor no entero
--    (pulgada = 25.4 mm) no puede ser unidad de STOCK sin perder mercancía por
--    redondeo. Sirve como unidad de compra o de presentación.
-- ---------------------------------------------------------------------
ALTER TABLE "units_of_measure"
  ADD COLUMN IF NOT EXISTS "is_stock_eligible" BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------
-- 2) Precio por N unidades (price unit / Preiseinheit de SAP)
--    products.price_unit_quantity dice a cuántas unidades de stock corresponde
--    base_price. La línea de venta guarda el snapshot para que el total sea
--    reproducible: unit_price * quantity / price_unit_quantity.
-- ---------------------------------------------------------------------
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "price_unit_quantity" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "order_items"       ADD COLUMN IF NOT EXISTS "price_unit_quantity" INTEGER;
ALTER TABLE "sales_order_items" ADD COLUMN IF NOT EXISTS "price_unit_quantity" INTEGER;
ALTER TABLE "quotation_items"   ADD COLUMN IF NOT EXISTS "price_unit_quantity" INTEGER;
ALTER TABLE "invoice_items"     ADD COLUMN IF NOT EXISTS "price_unit_quantity" INTEGER;

-- ---------------------------------------------------------------------
-- 3) refund_items.stock_units_consumed
--    Devolver 1 bulto de 50 debe reponer 50 unidades, no 1. La columna guarda
--    lo repuesto para que la devolución sea auditable con el mismo criterio
--    que la venta.
-- ---------------------------------------------------------------------
ALTER TABLE "refund_items"
  ADD COLUMN IF NOT EXISTS "stock_units_consumed" INTEGER;

-- ---------------------------------------------------------------------
-- 4) Catálogo de unidades comunes de venta
--    Criterio de pertenencia: una unidad vive acá cuando su factor es UNIVERSAL
--    (una docena siempre es 12). Cuando el factor depende del producto ("rollo"
--    es 20 m en una manguera y 50 m en otra) es una PRESENTACIÓN y vive en
--    price_tiers. Bases: g (masa), ml (volumen), mm (longitud), unit (conteo).
-- ---------------------------------------------------------------------
INSERT INTO "units_of_measure" ("code", "name", "dimension", "is_base", "factor_to_base", "is_stock_eligible") VALUES
  -- masa (base: g). La libra comercial colombiana son 500 g exactos.
  ('lb',      'Libra',            'mass',   false, 500.000000,        true),
  ('arroba',  'Arroba',           'mass',   false, 12500.000000,      true),
  ('qq',      'Quintal',          'mass',   false, 50000.000000,      true),
  ('ton',     'Tonelada',         'mass',   false, 1000000.000000,    true),
  -- volumen (base: ml)
  ('m3',      'Metro cúbico',     'volume', false, 1000000.000000,    true),
  ('gal',     'Galón',            'volume', false, 3785.411784,       false),
  -- longitud (base: mm)
  ('mm',      'Milímetro',        'length', true,  1.000000,          true),
  ('cm',      'Centímetro',       'length', false, 10.000000,         true),
  ('m',       'Metro',            'length', false, 1000.000000,       true),
  ('km',      'Kilómetro',        'length', false, 1000000.000000,    true),
  ('in',      'Pulgada',          'length', false, 25.400000,         false),
  ('ft',      'Pie',              'length', false, 304.800000,        false),
  ('yd',      'Yarda',            'length', false, 914.400000,        false),
  -- conteo (base: unit)
  ('par',     'Par',              'count',  false, 2.000000,          true),
  ('med_doc', 'Media docena',     'count',  false, 6.000000,          true),
  ('doc',     'Docena',           'count',  false, 12.000000,         true),
  ('ciento',  'Ciento',           'count',  false, 100.000000,        true),
  ('millar',  'Millar',           'count',  false, 1000.000000,       true)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------
-- 5) Marcar como no elegibles para stock las unidades preexistentes cuyo
--    factor no es entero. Hoy solo 'mg' (0.001 g) cumple la condición.
--    Acotado por WHERE: nunca un UPDATE sin filtro.
-- ---------------------------------------------------------------------
UPDATE "units_of_measure"
   SET "is_stock_eligible" = false, "updated_at" = NOW()
 WHERE "factor_to_base" <> TRUNC("factor_to_base")
   AND "is_stock_eligible" = true;

-- ---------------------------------------------------------------------
-- 6) Índices de lectura del catálogo
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "units_of_measure_dimension_stock_idx"
  ON "units_of_measure"("dimension", "is_stock_eligible");
