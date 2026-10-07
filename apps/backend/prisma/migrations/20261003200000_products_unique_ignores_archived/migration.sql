-- products: sku, slug y barcode unicos SOLO entre productos no archivados.
-- Borrar un producto = archivarlo (state = 'archived'); la fila conserva sus
-- identificadores. Los archivados los liberan sin tocar sus datos.
--
-- DATA IMPACT: none — no rows modified. Solo cambia el esquema de indices:
-- Tables affected: products (indices unicos completos -> parciales)
-- Destructive operations: none (no DROP TABLE/COLUMN, no CASCADE, no DELETE/UPDATE)
-- FK/cascade risk: none (ninguna FK referencia estos indices)
-- Idempotency: IF NOT EXISTS / IF EXISTS en cada sentencia
-- Orden: se crean los parciales ANTES de soltar los completos, asi nunca hay
-- un intervalo sin unicidad. Los parciales son mas laxos que los completos,
-- por lo que los datos existentes siempre los satisfacen.

-- 1. Nuevos indices unicos parciales (Prisma no puede expresarlos).
CREATE UNIQUE INDEX IF NOT EXISTS "products_store_id_sku_active_key"
  ON "products" ("store_id", "sku")
  WHERE "state" <> 'archived' AND "sku" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "products_store_id_slug_active_key"
  ON "products" ("store_id", "slug")
  WHERE "state" <> 'archived';

CREATE UNIQUE INDEX IF NOT EXISTS "products_store_id_barcode_active_key"
  ON "products" ("store_id", "barcode")
  WHERE "state" <> 'archived' AND "barcode" IS NOT NULL;

-- 2. Indice no unico para slug (los otros dos ya existen).
CREATE INDEX IF NOT EXISTS "products_store_id_slug_idx"
  ON "products" ("store_id", "slug");

-- 3. Soltar los unicos completos. sku es CONSTRAINT; slug y barcode, INDEX.
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_store_id_sku_key";
DROP INDEX IF EXISTS "products_store_id_sku_key";
DROP INDEX IF EXISTS "products_store_id_slug_key";
DROP INDEX IF EXISTS "products_store_id_barcode_key";
