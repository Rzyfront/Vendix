-- DATA IMPACT:
-- Tables affected: purchase_orders, purchase_order_items, inventory_cost_layers, audit_logs
-- Expected row changes: 0 (CERO filas mutadas — solo ADD COLUMN, ADD CONSTRAINT, CREATE INDEX)
--   `purchase_order_items.allocated_shipping_amount` es NOT NULL DEFAULT 0: Postgres 11+
--   materializa el default sin reescribir la tabla, y el valor sembrado (0) es
--   semanticamente correcto para toda fila existente — ninguna orden anterior
--   al ticket prorrateo flete.
-- Destructive operations: ninguna. Sin DROP, sin TRUNCATE, sin DELETE, sin UPDATE, sin CASCADE.
-- FK/cascade risk: la unica FK nueva es
--   inventory_cost_layers.purchase_order_item_id -> purchase_order_items(id)
--   con ON DELETE SET NULL — NUNCA CASCADE: borrar una linea de compra no puede
--   llevarse por delante la capa de costo que sostiene la valoracion de inventario.
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS y guardas
--   sobre pg_constraint para la FK y el CHECK — re-ejecutable sin error.
-- Reversibility: ver bloque al final del archivo.
-- Approval: plan critico CP-PURCHASE-TRANSPARENCY, bloques C.1 y C.10.

-- ---------------------------------------------------------------------------
-- C.1 — El flete deja de ser un numero mudo en la cabecera.
--
-- `purchase_orders.shipping_cost` ya existia y ya viaja en el payload: NO se
-- toca. Lo que faltaba era decir QUE se hizo con el, y cuanto de el aterrizo en
-- cada linea.
-- ---------------------------------------------------------------------------

-- `shipping_cost_allocation` es NULLABLE a proposito: las ordenes existentes
-- nunca tomaron esta decision y no se les inventa una. Un default silencioso
-- reescribiria a posteriori la intencion del operador que las creo, que es
-- justamente lo que este plan viene a impedir.
-- Guardada como VARCHAR(20) con CHECK, calcando `payment_plan` en esta misma
-- tabla: una decision enumerada que no justifica crear un tipo enum de Postgres
-- (los enum de PG no se pueden reducir y su ADD VALUE arrastra reglas propias).
ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "shipping_cost_allocation" VARCHAR(20);

-- CHECK sobre una columna creada en ESTA MISMA migracion: no hay ninguna fila
-- con un valor que pueda violarlo, asi que no puede fallar al aplicarse.
-- `purchase_orders` no tenia ninguna restriccion CHECK hasta ahora.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_orders_shipping_cost_allocation_check'
      AND conrelid = 'purchase_orders'::regclass
  ) THEN
    ALTER TABLE "purchase_orders"
      ADD CONSTRAINT "purchase_orders_shipping_cost_allocation_check"
      CHECK (
        "shipping_cost_allocation" IS NULL
        OR "shipping_cost_allocation" IN ('prorate', 'expense')
      );
  END IF;
END $$;

-- Porcion del flete de la cabecera que aterrizo en ESTA linea.
--
-- NOT NULL DEFAULT 0 a proposito: un nulo aqui obligaria a cada consumidor
-- (costeo, capas FIFO, reportes de valoracion) a decidir que significa, y ya
-- sabemos que significa cero.
--
-- DECIMAL(12,2) — NO (12,4). Es un monto de LINEA, no un precio unitario. En
-- `purchase_order_items` los (12,4) son unitarios (`unit_cost`,
-- `unit_price_net`) y los montos de linea son (12,2) (`total_cost`,
-- `discount_amount`, `tax_amount`, `deductible_tax_amount`). Ademas su origen,
-- `purchase_orders.shipping_cost`, es (12,2): con dos decimales el prorrateo
-- por mayor-residuo suma EXACTO al flete de la cabecera, mientras que guardar
-- cuatro fabricaria un total que no cuadra al mostrarse redondeado. El
-- antecedente de este repositorio (un Decimal(12,4) contra un DTO de 2
-- decimales) desaconseja elegir 4 por reflejo.
ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "allocated_shipping_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- C.10 — Trazabilidad: poder demostrar a posteriori que la cifra aprobada es
-- la que se sello.
-- ---------------------------------------------------------------------------

-- Ata la vista previa que el operador aprobo con la orden que se persistio.
-- Hoy no existe NADA que permita esa demostracion.
ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "preview_id" UUID;

-- La capa de costo solo conocia la ORDEN. Con recepciones parciales, o con el
-- mismo producto en dos lineas a costos distintos, la verificacion de paridad
-- devolvia N filas y no habia forma de saber cual correspondia a cual: sin esta
-- columna la verificacion central del plan solo es ejecutable en laboratorio.
-- Nullable: las capas historicas no pueden reconstruir su linea, y las que no
-- nacen de una compra (ajustes, transferencias) no tienen ninguna.
ALTER TABLE "inventory_cost_layers"
  ADD COLUMN IF NOT EXISTS "purchase_order_item_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_cost_layers_purchase_order_item_id_fkey'
      AND conrelid = 'inventory_cost_layers'::regclass
  ) THEN
    ALTER TABLE "inventory_cost_layers"
      ADD CONSTRAINT "inventory_cost_layers_purchase_order_item_id_fkey"
      FOREIGN KEY ("purchase_order_item_id")
      REFERENCES "purchase_order_items"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- Indice de la FK recien creada. `inventory_cost_layers` no esta entre las
-- tablas grandes del sistema y la columna acaba de nacer 100% NULL, asi que el
-- CREATE INDEX normal es instantaneo y no justifica CONCURRENTLY.
CREATE INDEX IF NOT EXISTS "inventory_cost_layers_purchase_order_item_id_idx"
  ON "inventory_cost_layers"("purchase_order_item_id");

-- Donde guardar el token de correlacion que `request-context.interceptor.ts`
-- (lineas 41-52) ya genera o HEREDA del header `X-Request-Id` y sella en el
-- ALS. La tabla no tenia columna para el, pese al comentario de
-- `http-exception.filter.ts` (lineas 155-163) que afirma que la auditoria ya lo
-- lleva.
--
-- TEXTO, no `uuid`: el interceptor acepta el header entrante tal cual, asi que
-- el valor puede no ser un UUID valido y una columna `uuid` reventaria la
-- escritura de auditoria por culpa de un header mal formado de un tercero.
ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "request_id" VARCHAR(100);

-- ---------------------------------------------------------------------------
-- NOTA: los indices de `audit_logs` y `products` NO estan en este archivo.
-- Ambas son tablas grandes y sus indices se crean con CREATE INDEX CONCURRENTLY
-- en la migracion hermana 20260822180100_purchase_transparency_concurrent_indexes,
-- que contiene UNICAMENTE sentencias CONCURRENTLY (ver el encabezado de ese
-- archivo para el porque de la separacion).
-- ---------------------------------------------------------------------------

-- ROLLBACK (manual, no lo ejecuta Prisma):
--   ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "request_id";
--   ALTER TABLE "inventory_cost_layers"
--     DROP CONSTRAINT IF EXISTS "inventory_cost_layers_purchase_order_item_id_fkey";
--   DROP INDEX IF EXISTS "inventory_cost_layers_purchase_order_item_id_idx";
--   ALTER TABLE "inventory_cost_layers" DROP COLUMN IF EXISTS "purchase_order_item_id";
--   ALTER TABLE "purchase_order_items" DROP COLUMN IF EXISTS "allocated_shipping_amount";
--   ALTER TABLE "purchase_orders"
--     DROP CONSTRAINT IF EXISTS "purchase_orders_shipping_cost_allocation_check";
--   ALTER TABLE "purchase_orders" DROP COLUMN IF EXISTS "preview_id";
--   ALTER TABLE "purchase_orders" DROP COLUMN IF EXISTS "shipping_cost_allocation";
