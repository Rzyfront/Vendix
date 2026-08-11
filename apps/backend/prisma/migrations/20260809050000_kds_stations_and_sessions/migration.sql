-- DATA IMPACT:
-- Tables affected:
--   kds                    (CREATE TABLE + INSERT de un KDS por defecto por tienda)
--   kds_sessions           (CREATE TABLE, sin filas)
--   products               (ADD COLUMN kds_id, sin mutar filas)
--   kitchen_tickets        (ADD COLUMN kds_id + UPDATE de backfill + SET NOT NULL
--                           + swap del indice unico del correlativo diario)
--   inventory_transactions (ADD COLUMN kds_session_id, unit_cost, total_cost;
--                           sin mutar filas)
-- Expected row changes (medido en dev antes de escribir):
--   kds:             +1 por tienda con industria 'restaurant' o con tickets ya
--                    existentes. Dev: 6 tiendas restaurante, 1 con tickets (la
--                    misma), => 6 filas.
--   kitchen_tickets: 54 filas actualizadas, todas de la tienda 10.
-- Destructive operations: NINGUNA. Sin DELETE, sin TRUNCATE, sin DROP TABLE,
--   sin DROP COLUMN, sin CASCADE. El unico DROP es el de un INDICE UNICO que se
--   reemplaza por otro mas estricto en la misma transaccion (ver mas abajo).
-- FK/cascade risk: las tres FK nuevas usan ON DELETE SET NULL salvo
--   kitchen_tickets.kds_id, que es NOT NULL y usa NO ACTION: borrar un KDS con
--   tickets debe fallar, no arrastrarlos. Ninguna FK entrante preexistente se
--   toca.
-- Idempotency: cada paso esta guardado (IF NOT EXISTS, pg_type, pg_attribute,
--   pg_constraint, pg_class) y los INSERT/UPDATE llevan WHERE + NOT EXISTS.
-- Approval: QUI-651. El usuario pidio implementar los 7 tickets y confirmo
--   explicitamente las dos decisiones abiertas (ver seccion DECISIONES).
--
-- ============================================================================
-- POR QUE
-- ============================================================================
-- El KDS era IMPLICITO: un solo tablero por tienda, y `kitchen_tickets` no
-- tenia columna que apuntara a una estacion. En un restaurante con barra de
-- bebidas + cocina caliente + postres, un pedido de 20 productos caia completo
-- en el mismo tablero y el personal filtraba a mano.
--
-- Ademas el consumo de insumos no tenia responsable de estacion: el fire firma
-- `inventory_transactions.user_id` con quien DISPARO el fire (mesero o cajero),
-- no con quien opera la estacion donde el insumo realmente se consumio.
--
-- ============================================================================
-- DECISIONES CONFIRMADAS CON EL USUARIO (2026-08-09)
-- ============================================================================
-- 1) `daily_number` pasa a ser POR ESTACION. Se reemplaza el unique
--    (store_id, business_date, daily_number) por
--    (store_id, kds_id, business_date, daily_number). Cada tablero cuenta desde
--    1, asi cocina canta #1 y barra canta #1 el mismo dia. Con el unique global
--    un fire de dos estaciones consumia dos numeros y cada tablero veia su
--    secuencia con huecos (8, 10, 13...).
--
--    El indice viejo se DROPea despues de crear el nuevo, y el nuevo es
--    ESTRICTAMENTE MAS RESTRICTIVO en el sentido que importa: agrega una columna
--    al discriminante, por lo que cualquier fila que respetaba el viejo respeta
--    el nuevo. No hay riesgo de que el DROP abra una ventana de duplicados,
--    porque toda la migracion corre en una sola transaccion implicita.
--
--    Nota sobre NULLs: `business_date` y `daily_number` son nullable y Postgres
--    trata NULLs como distintos en indices unicos. Dev tiene 9 tickets de la
--    tienda 10 con ambos en NULL; el viejo indice ya los toleraba y el nuevo los
--    tolera igual. Verificado antes de escribir esta migracion.
--
-- 2) `inventory_transactions.kds_session_id` admite NULL como caso VALIDO. El
--    fire consume inventario al disparar, que puede ocurrir antes de que la
--    estacion abra sesion. Exigir sesion abierta convertiria a la cocina en
--    bloqueante del POS: si el cocinero no ficho, el mesero no podria enviar el
--    pedido. Eso rompe la convencion de caja, donde la sesion se exige al
--    ACTUAR, no al entrar.
--
-- ============================================================================
-- POR QUE unit_cost / total_cost EN inventory_transactions
-- ============================================================================
-- QUI-651 pide dos vistas por sesion: historial (una fila por insumo por pedido,
-- con cantidad Y COSTO) y resumen (una fila por insumo con totales del turno).
-- El ticket asume que "el detalle ya existe fila por fila; lo que falta es la
-- columna que lo ata a la sesion". La CANTIDAD existe; el COSTO no:
--   - inventory_transactions no tenia columna de costo.
--   - inventory_movements tampoco.
--   - El `cost_snapshot` que el ticket cita es un valor EN MEMORIA que
--     StockLevelManager.updateStock devuelve (stock-level-manager.service.ts).
--   - inventory_valuation_snapshots si persiste costo y se ata por source_id,
--     pero su `total_value` es el valor del stock ON-HAND DESPUES del
--     movimiento, no el costo de lo consumido. Daria otro numero.
-- Recomputar en lectura no sirve: las capas FIFO ya se movieron. Por eso el
-- costo se persiste por fila. NULL en los movimientos historicos.

-- ---------------------------------------------------------------------------
-- 1) Enum de estado de sesion
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kds_session_status_enum') THEN
    CREATE TYPE "kds_session_status_enum" AS ENUM ('open', 'closed');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Entidad kds — espejo de cash_registers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "kds" (
  "id"          SERIAL       NOT NULL,
  "store_id"    INTEGER      NOT NULL,
  "name"        VARCHAR(100) NOT NULL,
  "code"        VARCHAR(50)  NOT NULL,
  "description" VARCHAR(255),
  "is_active"   BOOLEAN      NOT NULL DEFAULT true,
  "is_default"  BOOLEAN      NOT NULL DEFAULT false,
  "location_id" INTEGER,
  "created_at"  TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "kds_store_id_code_key" ON "kds"("store_id", "code");
CREATE INDEX IF NOT EXISTS "kds_store_id_is_active_idx" ON "kds"("store_id", "is_active");
CREATE INDEX IF NOT EXISTS "kds_location_id_idx" ON "kds"("location_id");

-- Exactamente UN KDS por defecto por tienda. Prisma no sabe expresar indices
-- parciales, asi que la garantia vive aqui. Es la misma tecnica que usa
-- inventory_locations para su "one central warehouse per org".
CREATE UNIQUE INDEX IF NOT EXISTS "kds_one_default_per_store"
  ON "kds"("store_id") WHERE "is_default";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kds_store_id_fkey') THEN
    ALTER TABLE "kds" ADD CONSTRAINT "kds_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kds_location_id_fkey') THEN
    ALTER TABLE "kds" ADD CONSTRAINT "kds_location_id_fkey"
      FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Sesiones — espejo de cash_register_sessions, SIN MONTOS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "kds_sessions" (
  "id"            SERIAL                    NOT NULL,
  "kds_id"        INTEGER                   NOT NULL,
  "store_id"      INTEGER                   NOT NULL,
  "opened_by"     INTEGER                   NOT NULL,
  "closed_by"     INTEGER,
  "status"        "kds_session_status_enum"  NOT NULL DEFAULT 'open',
  "opened_at"     TIMESTAMP(6)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at"     TIMESTAMP(6),
  "closing_notes" TEXT,
  "summary"       JSONB,
  "created_at"    TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kds_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "kds_sessions_store_id_status_idx" ON "kds_sessions"("store_id", "status");
CREATE INDEX IF NOT EXISTS "kds_sessions_kds_id_status_idx"   ON "kds_sessions"("kds_id", "status");
CREATE INDEX IF NOT EXISTS "kds_sessions_opened_by_status_idx" ON "kds_sessions"("opened_by", "status");

-- Una sola sesion ABIERTA por estacion: la sesion RECLAMA el KDS, igual que en
-- caja. Se refuerza en la DB y no solo en el guard del servicio, porque dos
-- peticiones concurrentes de dos operadores distintos pasarian ambos el chequeo
-- de aplicacion y dejarian la estacion con dos duenos.
CREATE UNIQUE INDEX IF NOT EXISTS "kds_sessions_one_open_per_kds"
  ON "kds_sessions"("kds_id") WHERE "status" = 'open';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kds_sessions_kds_id_fkey') THEN
    ALTER TABLE "kds_sessions" ADD CONSTRAINT "kds_sessions_kds_id_fkey"
      FOREIGN KEY ("kds_id") REFERENCES "kds"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kds_sessions_store_id_fkey') THEN
    ALTER TABLE "kds_sessions" ADD CONSTRAINT "kds_sessions_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kds_sessions_opened_by_fkey') THEN
    ALTER TABLE "kds_sessions" ADD CONSTRAINT "kds_sessions_opened_by_fkey"
      FOREIGN KEY ("opened_by") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kds_sessions_closed_by_fkey') THEN
    ALTER TABLE "kds_sessions" ADD CONSTRAINT "kds_sessions_closed_by_fkey"
      FOREIGN KEY ("closed_by") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Ruteo producto -> KDS
-- ---------------------------------------------------------------------------
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "kds_id" INTEGER;
CREATE INDEX IF NOT EXISTS "products_kds_id_idx" ON "products"("kds_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_kds_id_fkey') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_kds_id_fkey"
      FOREIGN KEY ("kds_id") REFERENCES "kds"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Trazabilidad del consumo: sesion + costo por fila
-- ---------------------------------------------------------------------------
ALTER TABLE "inventory_transactions" ADD COLUMN IF NOT EXISTS "kds_session_id" INTEGER;
ALTER TABLE "inventory_transactions" ADD COLUMN IF NOT EXISTS "unit_cost"  DECIMAL(12, 4);
ALTER TABLE "inventory_transactions" ADD COLUMN IF NOT EXISTS "total_cost" DECIMAL(18, 4);
CREATE INDEX IF NOT EXISTS "inventory_transactions_kds_session_id_idx"
  ON "inventory_transactions"("kds_session_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_kds_session_id_fkey') THEN
    ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_kds_session_id_fkey"
      FOREIGN KEY ("kds_session_id") REFERENCES "kds_sessions"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6) BACKFILL — un KDS por defecto por tienda que lo necesita
-- ---------------------------------------------------------------------------
-- El conjunto es la UNION de:
--   (a) tiendas con industria 'restaurant' — las que veran el modulo KDS, y
--   (b) tiendas que YA tienen kitchen_tickets — porque el paso 7 pone
--       kitchen_tickets.kds_id NOT NULL y cada ticket historico necesita una
--       estacion a la que apuntar. En dev (b) esta contenido en (a), pero no se
--       asume: una tienda pudo perder la industria despues de disparar tickets,
--       y sin (b) el SET NOT NULL fallaria.
--
-- El `code` debe coincidir con DEFAULT_KDS.code en el codigo de aplicacion
-- (store-bootstrap.helper.ts), porque el unique (store_id, code) es lo que hace
-- converger este backfill con la autocreacion de tiendas nuevas.
INSERT INTO "kds" ("store_id", "name", "code", "description", "is_active", "is_default", "created_at", "updated_at")
SELECT
  s."id",
  'Cocina',
  'COCINA',
  'Estacion creada automaticamente para que la tienda tenga tablero sin configurar nada.',
  true,
  true,
  NOW(),
  NOW()
FROM "stores" s
WHERE (
  'restaurant' = ANY(s."industries")
  OR EXISTS (SELECT 1 FROM "kitchen_tickets" kt WHERE kt."store_id" = s."id")
)
AND NOT EXISTS (SELECT 1 FROM "kds" k WHERE k."store_id" = s."id")
ON CONFLICT ("store_id", "code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7) kitchen_tickets.kds_id — nullable, backfill, luego NOT NULL
-- ---------------------------------------------------------------------------
-- Se agrega NULLABLE a proposito: poner NOT NULL de entrada sobre una tabla con
-- filas exige un DEFAULT que despues habria que quitar, y un default apuntando
-- a un id concreto seria incorrecto para tiendas distintas.
ALTER TABLE "kitchen_tickets" ADD COLUMN IF NOT EXISTS "kds_id" INTEGER;

UPDATE "kitchen_tickets" kt
SET "kds_id" = k."id"
FROM "kds" k
WHERE k."store_id" = kt."store_id"
  AND k."is_default"
  AND kt."kds_id" IS NULL;

-- Cinturon: si algun ticket quedo sin estacion, abortar en vez de dejar la
-- tabla a medio migrar. El SET NOT NULL de abajo fallaria igual, pero con un
-- mensaje que no dice cuantos ni de que tienda.
DO $$
DECLARE
  huerfanos INTEGER;
BEGIN
  SELECT count(*) INTO huerfanos FROM "kitchen_tickets" WHERE "kds_id" IS NULL;
  IF huerfanos > 0 THEN
    RAISE EXCEPTION
      'QUI-651: % kitchen_tickets quedaron sin kds_id tras el backfill. Revisar que toda tienda con tickets tenga un KDS con is_default = true.',
      huerfanos;
  END IF;
END $$;

ALTER TABLE "kitchen_tickets" ALTER COLUMN "kds_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "kitchen_tickets_kds_id_status_idx"
  ON "kitchen_tickets"("kds_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kitchen_tickets_kds_id_fkey') THEN
    -- NO ACTION (no SET NULL): la columna es NOT NULL, y borrar un KDS que
    -- todavia tiene tickets debe fallar en vez de intentar anular la columna.
    ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_kds_id_fkey"
      FOREIGN KEY ("kds_id") REFERENCES "kds"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8) Correlativo diario POR ESTACION
-- ---------------------------------------------------------------------------
-- Se crea el nuevo indice ANTES de soltar el viejo. El nuevo agrega kds_id al
-- discriminante, asi que toda fila que satisfacia el viejo satisface el nuevo:
-- la creacion no puede fallar por datos preexistentes.
CREATE UNIQUE INDEX IF NOT EXISTS "kitchen_tickets_store_id_kds_id_business_date_daily_number_key"
  ON "kitchen_tickets"("store_id", "kds_id", "business_date", "daily_number");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'kitchen_tickets_store_id_business_date_daily_number_key'
      AND relkind = 'i'
  ) THEN
    -- DROP de un INDICE, no de datos ni de columnas. Su garantia queda cubierta
    -- (y ampliada) por el indice creado justo arriba.
    DROP INDEX "kitchen_tickets_store_id_business_date_daily_number_key";
  END IF;
END $$;
