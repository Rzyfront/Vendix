-- DATA IMPACT:
-- Tables affected:
--   · invoice_profiles — 1 índice único AGREGADO. Ninguna columna, ninguna fila.
-- Expected row changes: 0 filas mutadas. Es DDL puro. La única lectura es el
--   guard de duplicados de más abajo, que cuenta y no escribe.
-- Destructive operations: NINGUNA. Sin DROP, sin TRUNCATE, sin CASCADE, sin
--   DELETE, sin UPDATE.
-- FK/cascade risk: ninguno. No se toca ninguna FK.
-- Idempotency: CREATE UNIQUE INDEX IF NOT EXISTS. Re-ejecutable.
-- Approval: estructura nueva sin mutación de filas.
--
-- PUEDE FALLAR EL DEPLOY, y eso es deliberado: si al momento de aplicarse
-- existieran dos perfiles con el mismo nombre en una tienda, el guard aborta con
-- un mensaje que los nombra. La alternativa —renombrarlos automáticamente—
-- sería mutar datos de configuración fiscal sin que nadie lo pidiera, y el
-- nombre es lo único que el usuario usa para saber cuál perfil está eligiendo.
-- A la fecha de escritura la tabla nace en la migración inmediatamente anterior
-- (20260822200000) y llega vacía a producción, así que el guard no puede
-- dispararse en este deploy; existe para el día en que alguien reordene o
-- reaplique migraciones sobre datos ya cargados.

-- ─────────────────────────────────────────────────────────────────────────────
-- Guard: nombres duplicados por tienda (comparación insensible a mayúsculas)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    dup_count integer;
    dup_sample text;
BEGIN
    SELECT count(*), string_agg(detalle, '; ')
      INTO dup_count, dup_sample
      FROM (
        SELECT format('store_id=%s nombre="%s" (%s filas, ids %s)',
                      store_id, min(name), count(*),
                      string_agg(id::text, ',' ORDER BY id)) AS detalle
          FROM invoice_profiles
         GROUP BY store_id, lower(name)
        HAVING count(*) > 1
         LIMIT 10
      ) AS duplicados;

    IF COALESCE(dup_count, 0) > 0 THEN
        RAISE EXCEPTION
            'No se puede crear el índice único de nombre de perfil: hay % grupo(s) de nombres duplicados por tienda. %. Renombra manualmente los perfiles afectados y vuelve a aplicar la migración.',
            dup_count, dup_sample;
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- El índice
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Único por (store_id, lower(name)). Tres decisiones dentro de esa línea:
--
-- 1. `lower(name)` y no `name`. "AIU obras" y "aiu obras" son el mismo perfil a
--    ojos de quien lo elige en un desplegable; dos filas que sólo difieren en la
--    caja convierten el selector del wizard en una trampa. La normalización de
--    espacios (recorte y colapso de los internos) la hace el DTO ANTES de
--    llegar acá: sin ella el índice sería evadible con un espacio doble.
--
--    NO se aplica `unaccent`: exigiría la extensión y "Estándar"/"Estandar"
--    seguirían siendo distintos para el usuario, no sólo para el índice.
--
-- 2. Es `store_id` y no `organization_id`. El módulo vive en el menú de tienda y
--    la columna `store_id` es NOT NULL a propósito (ver el esquema): dos tiendas
--    de la misma organización pueden tener cada una su "Estándar DIAN", y deben
--    poder.
--
-- 3. Sin `WHERE`, a diferencia del índice de predeterminados. No hay borrado
--    lógico en esta tabla: el DELETE es real y libera el nombre. Un índice
--    parcial acá excluiría filas que sí compiten por el nombre.
--
-- Prisma NO puede representar un índice sobre una expresión: vive únicamente en
-- este SQL. No lo borres creyendo que el esquema lo cubre.
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_profiles_unique_name_per_store"
    ON "invoice_profiles" ("store_id", lower("name"));
