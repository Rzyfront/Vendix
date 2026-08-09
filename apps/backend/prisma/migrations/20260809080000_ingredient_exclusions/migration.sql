-- DATA IMPACT:
-- Tables affected:
--   order_items                    (ADD COLUMN notes, split_from_order_item_id)
--   order_item_exclusions          (CREATE TABLE, sin filas)
--   kitchen_ticket_item_exclusions (CREATE TABLE, sin filas)
-- Expected row changes: NINGUNA fila se muta. Solo columnas nullable nuevas y
--   dos tablas vacias. Todo item existente queda con notes NULL y sin
--   exclusiones, que es exactamente el comportamiento actual.
-- Destructive operations: none. Sin DELETE, UPDATE, TRUNCATE, DROP ni CASCADE
--   sobre tablas de negocio.
-- FK/cascade risk: las dos tablas nuevas usan ON DELETE CASCADE hacia su PADRE
--   (order_items / kitchen_ticket_items). Esto es correcto y NO es el caso que
--   las reglas prohiben: la exclusion no tiene vida propia — es un atributo de
--   la linea, y si la linea desaparece la exclusion no significa nada. Lo que
--   esta prohibido es CASCADE en tablas padre con datos de negocio, y aqui
--   order_items es el padre y no se le agrega ningun cascade entrante nuevo.
--   Las FK a `products` usan RESTRICT: no se puede borrar un insumo que figura
--   como excluido en historia, porque eso perderia la explicacion del margen.
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, indices
--   IF NOT EXISTS y FKs guardadas por pg_constraint.
-- Approval: QUI-655. El usuario pidio implementar los 7 tickets y reafirmo
--   "continua"; la decision de particion de linea se aplica segun la
--   recomendacion planteada y no contestada (ver mas abajo).
--
-- ============================================================================
-- POR QUE
-- ============================================================================
-- `fireOrderItems` explotaba la receta con `explodeBom` y consumia TODAS las
-- hojas del BOM. No existia ningun punto donde alguien pudiera decir "este plato
-- va sin papas", asi que un plato pedido sin un ingrediente consumia ese
-- ingrediente del inventario y lo cargaba al costo igual. El inventario quedaba
-- descuadrado contra la realidad fisica y el margen del plato subestimado.
--
-- ============================================================================
-- LA DECISION: PARTIR LA LINEA, NO `unit_index`
-- ============================================================================
-- Una linea con `quantity: 3` son tres platos en UNA fila. Sin identidad por
-- unidad es imposible expresar "de estos tres, uno va sin salsa" — y ese es el
-- caso normal, no el borde: una mesa pide tres del mismo plato y solo un comensal
-- tiene la restriccion.
--
-- Se parte la linea: `quantity: 3` pasa a `quantity: 2` (receta completa) +
-- `quantity: 1` (sin salsa). Cada linea queda HOMOGENEA y se preserva la
-- invariante que TODO el pipeline ya asume:
--   - `explodeBom` se multiplica por la cantidad de la linea
--   - `updateStock` consume por linea
--   - el COGS se suma por linea
--   - `kitchen_ticket_items` es una fila por linea
--
-- La alternativa (`unit_index` en la tabla de exclusiones) mantiene una sola
-- linea pero la vuelve HETEROGENEA: el consumo deja de ser `receta x quantity` y
-- pasa a ser `receta x 2 + (receta - salsa) x 1`, rompiendo esa aritmetica en
-- consumo, COGS, ticket de cocina e impresion — cuatro lugares a la vez.
--
-- El costo de partir es de PRESENTACION: el cliente pidio "3 pollos" y veria dos
-- filas. Se resuelve agrupando en la UI, y para eso existe
-- `split_from_order_item_id`, que apunta a la linea original.
--
-- Por eso NINGUNA de las dos tablas de exclusion lleva `unit_index`: con la linea
-- homogenea la exclusion aplica a toda la linea.
--
-- OJO: `split-order.service.ts` NO es arte previo reusable — declara
-- explicitamente que su split es FINANCIAL ONLY y que el inventario ya fue
-- consumido. Partir por pago y partir por preparacion son ejes distintos y
-- ocurren en momentos distintos del ciclo. Pero SI hay que verificar la
-- interaccion: una linea partida por preparacion entra despues al split
-- financiero, y ahi las cantidades tienen que seguir cuadrando.
--
-- ============================================================================
-- DOS REGISTROS, DOS ROLES
-- ============================================================================
-- `order_item_exclusions`          = LA INTENCION. Lo que el cliente pidio al
--   ordenar, cuando alguien lo capturo. OPCIONAL: puede estar vacia, porque la
--   captura al pedir no es obligatoria y la nota de texto libre requiere que el
--   cocinero la traduzca.
-- `kitchen_ticket_item_exclusions` = LO CONSUMIDO. Lo que efectivamente se
--   excluyo al confirmar el modal. Es lo que se costeo y lo que explica el
--   margen. Siempre existe cuando hubo exclusion.
-- Cuando ambas existen y difieren, esa diferencia es dato de auditoria:
-- exclusiones sistematicas del mismo insumo son merma no registrada o fuga.
--
-- `order_items.notes` es el tercer camino de captura y no existia: `order_items`
-- solo tenia `quantity`. En cambio `kitchen_ticket_items.notes` YA EXISTIA en el
-- schema, documentando textualmente este caso ("no onions", "allergy: gluten"),
-- y el codigo nunca la escribia: columna disenada y desconectada.

-- ---------------------------------------------------------------------------
-- 1) Captura al tomar el pedido + particion de linea
-- ---------------------------------------------------------------------------
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "split_from_order_item_id" INTEGER;

CREATE INDEX IF NOT EXISTS "order_items_split_from_order_item_id_idx"
  ON "order_items"("split_from_order_item_id");

-- ---------------------------------------------------------------------------
-- 2) La intencion (opcional)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "order_item_exclusions" (
  "id"                   SERIAL    NOT NULL,
  "order_item_id"        INTEGER   NOT NULL,
  "component_product_id" INTEGER   NOT NULL,
  "path_recipe_ids"      INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "created_by_user_id"   INTEGER,
  "created_at"           TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_item_exclusions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_item_exclusions_item_component_key"
  ON "order_item_exclusions"("order_item_id", "component_product_id");
CREATE INDEX IF NOT EXISTS "order_item_exclusions_order_item_id_idx"
  ON "order_item_exclusions"("order_item_id");
CREATE INDEX IF NOT EXISTS "order_item_exclusions_component_product_id_idx"
  ON "order_item_exclusions"("component_product_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_exclusions_order_item_id_fkey') THEN
    -- CASCADE hacia el padre a proposito: la exclusion es un ATRIBUTO de la
    -- linea y no tiene vida propia. Si la linea se elimina, la exclusion no
    -- significa nada.
    ALTER TABLE "order_item_exclusions" ADD CONSTRAINT "order_item_exclusions_order_item_id_fkey"
      FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_exclusions_component_product_id_fkey') THEN
    -- RESTRICT: no se puede borrar un insumo que figura como excluido en
    -- historia, porque se perderia la explicacion del margen de ese plato.
    ALTER TABLE "order_item_exclusions" ADD CONSTRAINT "order_item_exclusions_component_product_id_fkey"
      FOREIGN KEY ("component_product_id") REFERENCES "products"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_exclusions_created_by_user_id_fkey') THEN
    ALTER TABLE "order_item_exclusions" ADD CONSTRAINT "order_item_exclusions_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Lo consumido (obligatorio cuando hubo exclusion)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "kitchen_ticket_item_exclusions" (
  "id"                     SERIAL    NOT NULL,
  "kitchen_ticket_item_id" INTEGER   NOT NULL,
  "component_product_id"   INTEGER   NOT NULL,
  "path_recipe_ids"        INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "excluded_by_user_id"    INTEGER,
  "created_at"             TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kitchen_ticket_item_exclusions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "kti_exclusions_item_component_key"
  ON "kitchen_ticket_item_exclusions"("kitchen_ticket_item_id", "component_product_id");
CREATE INDEX IF NOT EXISTS "kti_exclusions_kitchen_ticket_item_id_idx"
  ON "kitchen_ticket_item_exclusions"("kitchen_ticket_item_id");
CREATE INDEX IF NOT EXISTS "kti_exclusions_component_product_id_idx"
  ON "kitchen_ticket_item_exclusions"("component_product_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kti_exclusions_kitchen_ticket_item_id_fkey') THEN
    ALTER TABLE "kitchen_ticket_item_exclusions" ADD CONSTRAINT "kti_exclusions_kitchen_ticket_item_id_fkey"
      FOREIGN KEY ("kitchen_ticket_item_id") REFERENCES "kitchen_ticket_items"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kti_exclusions_component_product_id_fkey') THEN
    ALTER TABLE "kitchen_ticket_item_exclusions" ADD CONSTRAINT "kti_exclusions_component_product_id_fkey"
      FOREIGN KEY ("component_product_id") REFERENCES "products"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kti_exclusions_excluded_by_user_id_fkey') THEN
    ALTER TABLE "kitchen_ticket_item_exclusions" ADD CONSTRAINT "kti_exclusions_excluded_by_user_id_fkey"
      FOREIGN KEY ("excluded_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) FK de la particion de linea
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_split_from_order_item_id_fkey') THEN
    -- SET NULL y no CASCADE: si la linea original se elimina, las partes NO
    -- deben desaparecer — son consumo real que ya paso por cocina. Pierden el
    -- puntero de agrupacion visual y nada mas.
    ALTER TABLE "order_items" ADD CONSTRAINT "order_items_split_from_order_item_id_fkey"
      FOREIGN KEY ("split_from_order_item_id") REFERENCES "order_items"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
