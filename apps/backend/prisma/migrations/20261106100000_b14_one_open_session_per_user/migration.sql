-- DATA IMPACT:
-- Tables affected: cash_register_sessions (solo se agrega un INDICE UNICO PARCIAL; no muta filas).
-- Expected row changes: none. Impone "una sola sesion abierta o suspendida por usuario y tienda"
--   ((store_id, opened_by) WHERE status IN ('open','suspended')) a nivel de base de datos.
-- Destructive operations: none (sin DROP/DELETE/TRUNCATE/UPDATE).
-- FK/cascade risk: none.
-- Idempotency: IF NOT EXISTS dentro de un bloque DO.
--
-- Contexto (caja B14): openSession validaba fuera de la transaccion, asi que dos aperturas
--   concurrentes podian dejar dos sesiones por usuario y las ventas se repartian entre ambas.
--
-- Comportamiento ante duplicados: si hoy existen usuarios con mas de una sesion abierta o
--   suspendida en la misma tienda, NO se crea el indice (RAISE NOTICE) y la migracion termina
--   sin error. Hay que cerrar las sesiones sobrantes desde la UI (con conteo declarado por un
--   humano) y volver a ejecutar el bloque. Consulta para identificarlos:
--     SELECT store_id, opened_by, count(*) FROM cash_register_sessions
--      WHERE status IN ('open','suspended') GROUP BY 1,2 HAVING count(*) > 1;
--
-- Nota Prisma: schema.prisma NO se toca (Prisma no expresa indices unicos parciales).
--   Sin CONCURRENTLY: Prisma envuelve la migracion en una transaccion.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND indexname = 'cash_register_sessions_one_open_per_user'
  ) THEN
    RAISE NOTICE 'cash_register_sessions_one_open_per_user ya existe; sin cambios';
  ELSIF EXISTS (
    SELECT 1 FROM cash_register_sessions
     WHERE status IN ('open', 'suspended')
     GROUP BY store_id, opened_by
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'cash_register_sessions_one_open_per_user NO creado: hay usuarios con mas de una sesion abierta/suspendida por tienda. Cierre las sobrantes desde la UI y cree el indice.';
  ELSE
    CREATE UNIQUE INDEX "cash_register_sessions_one_open_per_user"
      ON "cash_register_sessions"("store_id", "opened_by")
      WHERE "status" IN ('open', 'suspended');
  END IF;
END $$;
