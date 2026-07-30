-- DATA IMPACT:
-- Tables affected: cash_register_sessions (solo se agrega un INDICE UNICO PARCIAL; no muta filas).
-- Expected row changes: none. Impone la invariante "una sola sesion abierta por caja"
--   (cash_register_id) WHERE status='open' a nivel de base de datos.
-- Destructive operations: none (sin DROP/DELETE/TRUNCATE/UPDATE).
-- FK/cascade risk: none.
-- Idempotency: CREATE UNIQUE INDEX IF NOT EXISTS.
--
-- Contexto (QUI-560): `SessionsService.openSession` ya rechaza abrir una segunda sesion en una
--   caja que tiene una abierta, pero esa invariante vivia SOLO en la capa de aplicacion. DEV
--   demostro que se puede violar: la caja 19 de la tienda 10 acumulo dos sesiones 'open'
--   (ids 88 y 89). La DB es la unica capa que ninguna ruta de escritura puede saltarse.
--
-- Pre-check read-only 2026-07-30:
--   PROD: 0 grupos duplicados por (cash_register_id) WHERE status='open'
--         (4 sesiones abiertas sobre 40 totales) -> el indice se crea limpio.
--   DEV:  1 grupo duplicado (cash_register_id=19 con 2 sesiones abiertas). Se sanea CERRANDO
--         una de las dos por el flujo normal de cierre con conteo (POST /store/cash-registers/
--         sessions/:id/close), no borrando filas.
--
-- Comportamiento ante duplicados: si al desplegar existiera un duplicado, este CREATE UNIQUE INDEX
--   FALLA de forma SEGURA y bloquea el deploy sin destruir datos. Esa es la decision deliberada:
--   una sesion de caja abierta contiene movimientos de dinero reales, y resolver el duplicado
--   exige cerrar una con su conteo declarado por un humano. Inventar el conteo de cierre y la
--   diferencia sobrante/faltante desde una migracion seria destruir datos de negocio en silencio.
--   La consulta para identificar el conflicto:
--     SELECT cash_register_id, count(*) FROM cash_register_sessions
--      WHERE status='open' GROUP BY 1 HAVING count(*) > 1;
--
-- Nota Prisma: `schema.prisma` NO se toca. Prisma no puede expresar un indice unico parcial
--   (WHERE ...) en @@unique/@@index, igual que en 20260720200100_pop_fase5_cxp_one_per_oc_unique_index
--   y en los indices parciales del puente pago OC<->CxP. Vive solo como SQL crudo.
--   Sin CONCURRENTLY: Prisma envuelve cada migracion en una transaccion y
--   CREATE INDEX CONCURRENTLY no puede ejecutarse dentro de una.

CREATE UNIQUE INDEX IF NOT EXISTS "cash_register_sessions_one_open_per_register"
    ON "cash_register_sessions"("cash_register_id")
    WHERE "status" = 'open';
