-- DATA IMPACT:
-- Tables affected: cash_register_sessions (solo se agrega un INDICE UNICO PARCIAL; no muta filas).
-- Expected row changes: none. Impone "una sola sesion abierta o suspendida por usuario y tienda"
--   ((store_id, opened_by) WHERE status IN ('open','suspended')) a nivel de base de datos.
-- Destructive operations: none (sin DROP/DELETE/TRUNCATE/UPDATE).
-- FK/cascade risk: none.
-- Idempotency: IF NOT EXISTS dentro de un bloque DO (si el indice ya existe no hace nada).
--
-- Contexto (caja B14): openSession validaba fuera de la transaccion, asi que dos aperturas
--   concurrentes podian dejar dos sesiones por usuario y las ventas se repartian entre ambas.
--
-- Comportamiento ante duplicados: si hoy existen usuarios con mas de una sesion abierta o
--   suspendida en la misma tienda, la migracion FALLA (RAISE EXCEPTION con los pares
--   store_id/opened_by) y el deploy se detiene: el codigo cuenta con este indice, asi que
--   no puede quedar "aplicada" sin el. Hay que cerrar las sesiones sobrantes desde la UI (con
--   conteo declarado por un humano), marcar la migracion --rolled-back y redesplegar.
--   Consulta para identificarlos ANTES del deploy:
--     SELECT store_id, opened_by, count(*) FROM cash_register_sessions
--      WHERE status IN ('open','suspended') GROUP BY 1,2 HAVING count(*) > 1;
--
-- Nota Prisma: schema.prisma NO se toca (Prisma no expresa indices unicos parciales).
--   Sin CONCURRENTLY: Prisma envuelve la migracion en una transaccion.

DO $$
DECLARE
  dupes TEXT;
BEGIN
  SELECT string_agg(format('store_id=%s opened_by=%s sesiones=%s', store_id, opened_by, n), '; ')
    INTO dupes
    FROM (
      SELECT store_id, opened_by, count(*) AS n FROM cash_register_sessions
       WHERE status IN ('open', 'suspended')
       GROUP BY store_id, opened_by
      HAVING count(*) > 1
       ORDER BY store_id, opened_by
       LIMIT 50
    ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'cash_register_sessions_one_open_per_user NO creado: usuarios con mas de una sesion abierta/suspendida por tienda: %', dupes
      USING HINT = 'Cierre las sesiones sobrantes desde la UI, marque la migracion --rolled-back y redespliegue.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND indexname = 'cash_register_sessions_one_open_per_user'
  ) THEN
    CREATE UNIQUE INDEX "cash_register_sessions_one_open_per_user"
      ON "cash_register_sessions"("store_id", "opened_by")
      WHERE "status" IN ('open', 'suspended');
  END IF;
END $$;
