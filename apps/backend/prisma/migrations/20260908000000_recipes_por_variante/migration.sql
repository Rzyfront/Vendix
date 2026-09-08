-- Recetas por variante (plan docs/planes/recetas-por-variante-plan.md, pasos 1-2).
-- Cada variante de un plato tiene su propia receta con su propio BOM.
--
-- DATA IMPACT:
-- Tables affected:
--   · recipes — 1 columna AGREGADA (`product_variant_id`, nullable, sin DEFAULT)
-- Expected row changes: 0 filas leidas, 0 filas mutadas. Toda receta existente
--   queda con `product_variant_id = NULL` (sigue resolviendose como receta base,
--   intacta) y los indices parciales la cubren sin contarla como variante.
-- Destructive operations: NINGUNA sobre datos. Solo objetos: se elimina el
--   UNIQUE viejo `recipes_product_id_key` y se crean dos UNICOS parciales
--   (`recipes_product_base_uq`, `recipes_product_variant_uq`) en la misma
--   migracion, mas la FK `recipes_product_variant_id_fkey` y dos indices planos.
--   Sin DROP TABLE/COLUMN, sin TRUNCATE, sin CASCADE, sin DELETE, sin UPDATE,
--   sin backfill (NULL es el estado correcto del historico).
-- FK/cascade risk: la FK nueva es ON DELETE RESTRICT: borrar una variante con
--   receta propia se bloquea en vez de arrastrar la receta.
-- Idempotency: ADD COLUMN con IF NOT EXISTS (DO guardado por
--   information_schema); contador previo en DO block; FK dentro de DO guardado
--   por pg_constraint; DROP del unico viejo con IF EXISTS (constraint e indice,
--   segun como lo haya creado el motor); indices con IF NOT EXISTS. Reejecutable.
-- Approval: plan recetas-por-variante aprobado (pasos 1-4, backend base).
-- Rollback: revertir antes de crear recetas con variante; con uso, migracion
--   compensatoria (las filas con variante impedirian recrear el UNIQUE total).
--
-- Por que parciales y no `@@unique([product_id, product_variant_id])` en el
-- schema: Postgres considera distintos dos NULL, asi que un UNIQUE total
-- permitiria N recetas base para el mismo producto — exactamente lo que hoy
-- impide el `@unique` de `product_id`. Prisma no declara indices parciales,
-- igual que no declara otros parciales del repo — viven aca, documentados en
-- el schema del modelo `recipes`.

-- ---------------------------------------------------------------------------
-- 1. Columna `product_variant_id`: la variante duena de la receta.
-- NULL = receta base (recetas creadas antes de este cambio + productos SIN
-- variantes, que es el 100% del historico).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'recipes' AND column_name = 'product_variant_id'
  ) THEN
    ALTER TABLE "recipes" ADD COLUMN "product_variant_id" INTEGER;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Contador de duplicados PREVIO a los indices (paso 2 del plan).
-- Una migracion nunca crea un unico sin haber contado primero cuantas filas
-- lo violarian. Va ANTES de los CREATE UNIQUE INDEX: un RAISE colocado
-- despues seria codigo muerto porque el CREATE ya habria fallado con un
-- error de indice que no dice cuantas filas lo causaron.
-- Hoy la columna es nueva (todo NULL) y `product_id` tenia UNIQUE total,
-- asi que ambos conteos deben dar 0; si no, la migracion aborta con el conteo
-- exacto en vez de un error crudo de indice.
-- Pre-chequeo equivalente en produccion:
--   SELECT product_id, COUNT(*) FROM recipes
--   WHERE product_variant_id IS NULL GROUP BY 1 HAVING COUNT(*) > 1;
--   (debe dar 0 filas antes del deploy).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  base_dup_groups INT;
  variant_dup_groups INT;
BEGIN
  SELECT COUNT(*) INTO base_dup_groups FROM (
    SELECT "product_id" FROM "recipes"
    WHERE "product_variant_id" IS NULL
    GROUP BY "product_id" HAVING COUNT(*) > 1
  ) d;
  SELECT COUNT(*) INTO variant_dup_groups FROM (
    SELECT "product_id", "product_variant_id" FROM "recipes"
    WHERE "product_variant_id" IS NOT NULL
    GROUP BY "product_id", "product_variant_id" HAVING COUNT(*) > 1
  ) d;
  IF base_dup_groups > 0 OR variant_dup_groups > 0 THEN
    RAISE EXCEPTION 'recipes_por_variante: % grupo(s) base (product_id) duplicados y % grupo(s) (product_id, product_variant_id) duplicados. Limpia los duplicados antes de aplicar.', base_dup_groups, variant_dup_groups;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. FK a `product_variants`, guardada por catalogo para ser reejecutable.
-- RESTRICT: ni la variante se borra con receta, ni la receta arrastra nada.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_product_variant_id_fkey') THEN
    ALTER TABLE "recipes"
      ADD CONSTRAINT "recipes_product_variant_id_fkey"
      FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Borrar el unico viejo `recipes_product_id_key` (1 producto -> 1 receta).
-- Sin esto, la segunda receta de un producto variantizado seguiria bloqueada.
-- Se prueban las dos formas (constraint e indice) porque la migracion funda-
-- cional lo creo como UNIQUE INDEX y otros motores lo registran como
-- constraint; ambas con IF EXISTS, sin tocar filas.
-- ---------------------------------------------------------------------------
ALTER TABLE "recipes" DROP CONSTRAINT IF EXISTS "recipes_product_id_key";
DROP INDEX IF EXISTS "recipes_product_id_key";

-- ---------------------------------------------------------------------------
-- 5. Unicidad nueva: una base por producto + una receta por variante.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "recipes_product_base_uq"
  ON "recipes"("product_id") WHERE "product_variant_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "recipes_product_variant_uq"
  ON "recipes"("product_id", "product_variant_id") WHERE "product_variant_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Indices planos que el schema declara (@@index): preservan el plan de
-- consultas que antes cubria `recipes_product_id_key` (WHERE product_id = ?)
-- y aceleran el join por variante. Nombres = default de Prisma.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "recipes_product_id_idx"
  ON "recipes"("product_id");

CREATE INDEX IF NOT EXISTS "recipes_product_variant_id_idx"
  ON "recipes"("product_variant_id");
