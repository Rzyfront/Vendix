-- DATA IMPACT:
-- tablas: roles, user_roles
-- operacion: ADD COLUMN store_id (nullable) + FK + recreacion de indices unicos con
--            NULLS NOT DISTINCT + CHECK constraint de coherencia de alcance
-- filas afectadas: 0 filas mutadas. Backfill implicito store_id = NULL en todas las filas
--                  existentes => NINGUN rol ni asignacion cambia de alcance al migrar.
-- destructivo: NO. Sin DROP TABLE, sin TRUNCATE, sin DELETE/UPDATE sin WHERE.
-- idempotente: SI (ADD COLUMN IF NOT EXISTS, DROP INDEX IF EXISTS, DO $$ guards).
-- precondicion: PostgreSQL 15+ (NULLS NOT DISTINCT requiere 15+), migraciones QUI-473
--               20260724233150_roles_composite_unique y 20260725000000_roles_nulls_not_distinct
--               ya aplicadas.

-- QUI-72: los roles no tenian dimension de tienda. Un rol "creado desde la tienda A"
-- era en realidad un rol de organizacion y aparecia en todas las tiendas hermanas.
-- Esta migracion agrega la dimension faltante SIN reclasificar nada de lo existente:
-- toda fila previa queda con store_id = NULL, es decir sigue siendo rol de sistema o
-- de organizacion, exactamente como estaba.
--
-- El alcance queda DERIVADO de las FKs (sin columna de tipo redundante que se pueda
-- desincronizar):
--
--   is_system_role | organization_id | store_id | alcance
--   ---------------+-----------------+----------+--------------
--   true           | NULL            | NULL     | sistema
--   false          | set             | NULL     | organizacion
--   false          | set             | set      | tienda

-- =====================================================================
-- 1. roles.store_id
-- =====================================================================

ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "store_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'roles_store_id_fkey'
  ) THEN
    ALTER TABLE "roles"
      ADD CONSTRAINT "roles_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- store_id sin organization_id es un estado invalido: un rol de tienda pertenece
-- siempre a la organizacion duena de esa tienda.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'roles_store_requires_organization'
  ) THEN
    ALTER TABLE "roles"
      ADD CONSTRAINT "roles_store_requires_organization"
      CHECK ("store_id" IS NULL OR "organization_id" IS NOT NULL);
  END IF;
END $$;

-- Un rol de sistema no puede estar atado a una tienda ni a una organizacion.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'roles_system_role_has_no_tenant'
  ) THEN
    ALTER TABLE "roles"
      ADD CONSTRAINT "roles_system_role_has_no_tenant"
      CHECK (
        "is_system_role" = false
        OR ("organization_id" IS NULL AND "store_id" IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "roles_store_id_idx" ON "roles"("store_id");

-- Unique (organization_id, store_id, name) reemplazando (organization_id, name).
-- CONSERVA NULLS NOT DISTINCT de QUI-473: sin el modificador, (NULL, NULL, 'admin')
-- y (NULL, NULL, 'admin') se considerarian distintas y dos roles de sistema podrian
-- compartir nombre; y (5, NULL, 'Preventista') se podria duplicar dentro de la
-- misma organizacion.
DROP INDEX IF EXISTS "roles_organization_id_name_key";

CREATE UNIQUE INDEX IF NOT EXISTS "roles_organization_id_store_id_name_key"
  ON "roles"("organization_id", "store_id", "name")
  NULLS NOT DISTINCT;

-- =====================================================================
-- 2. user_roles.store_id
-- =====================================================================
-- NULL = la asignacion aplica en toda la organizacion (comportamiento actual,
-- preservado en el backfill). Un valor = aplica SOLO en esa tienda, que es lo que
-- permite ser Cajero en la tienda A y no en la B.

ALTER TABLE "user_roles" ADD COLUMN IF NOT EXISTS "store_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_store_id_fkey'
  ) THEN
    ALTER TABLE "user_roles"
      ADD CONSTRAINT "user_roles_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "user_roles_store_id_idx" ON "user_roles"("store_id");

-- Mismo razonamiento de NULLS NOT DISTINCT: sin el modificador, dos asignaciones
-- org-wide (user, role, NULL) no colisionarian y la fila se podria duplicar.
DROP INDEX IF EXISTS "user_roles_user_id_role_id_key";

CREATE UNIQUE INDEX IF NOT EXISTS "user_roles_user_id_role_id_store_id_key"
  ON "user_roles"("user_id", "role_id", "store_id")
  NULLS NOT DISTINCT;

-- =====================================================================
-- 3. Verificacion post-migracion (ejecutar a mano tras aplicar)
-- =====================================================================
--   SELECT indnullsnotdistinct FROM pg_index
--   WHERE indexrelid = '"roles_organization_id_store_id_name_key"'::regclass;   -- true
--   SELECT indnullsnotdistinct FROM pg_index
--   WHERE indexrelid = '"user_roles_user_id_role_id_store_id_key"'::regclass;   -- true
--   SELECT count(*) FROM roles WHERE store_id IS NOT NULL;                      -- 0
--   SELECT count(*) FROM user_roles WHERE store_id IS NOT NULL;                 -- 0
