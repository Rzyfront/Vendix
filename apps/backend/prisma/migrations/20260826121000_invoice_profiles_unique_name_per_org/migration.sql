-- DATA IMPACT:
-- Tables affected:
--   · invoice_profiles — 1 índice único parcial AGREGADO (name uniqueness
--                        en ámbito organización). 0 filas mutadas.
-- Destructive operations: NINGUNA. Sin DROP, sin TRUNCATE, sin CASCADE.
-- FK/cascade risk: ninguno. No se toca ninguna FK.
-- Idempotency: CREATE UNIQUE INDEX IF NOT EXISTS. Re-ejecutable.
--
-- Espejo de la migración 20260822210000_invoice_profiles_unique_name_per_store
-- para el ámbito ORG (store_id IS NULL). El índice anterior
-- (`invoice_profiles_unique_name_per_store` sobre (store_id, lower(name)))
-- NO cubre org-scoped: Postgres trata NULLs como distintos en índices únicos
-- ordinarios, así que dos perfiles plataforma con el mismo nombre en la misma
-- organización pasarían sin error — exactamente la trampa que el índice
-- store-scope cierra para tiendas. Esta migración cierra la misma trampa
-- para el ámbito ORG.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'invoice_profiles'
      AND indexname = 'invoice_profiles_unique_name_per_org'
  ) THEN
    CREATE UNIQUE INDEX "invoice_profiles_unique_name_per_org"
      ON "invoice_profiles" ("organization_id", lower("name"))
      WHERE "store_id" IS NULL;
  END IF;
END $$;

-- Guard de idempotencia: si al re-aplicar la migración existieran dos
-- perfiles org-scoped con el mismo nombre en la misma organización,
-- el índice abortaría con violación de unicidad. El guard los nombra.
DO $$
DECLARE
    dup_count integer;
    dup_sample text;
BEGIN
    SELECT count(*), string_agg(detalle, '; ')
      INTO dup_count, dup_sample
      FROM (
        SELECT format('org=%s nombre="%s" (%s ids %s)',
                      "organization_id", min("name"), count(*),
                      string_agg(id::text, ',' ORDER BY id)) AS detalle
          FROM "invoice_profiles"
         WHERE "store_id" IS NULL
         GROUP BY "organization_id", lower("name")
        HAVING count(*) > 1
         LIMIT 10
      ) AS duplicados;

    IF COALESCE(dup_count, 0) > 0 THEN
        RAISE EXCEPTION
            'No se puede crear invoice_profiles_unique_name_per_org: % grupo(s) de nombres duplicados por organización en perfiles plataforma. %. Renombra y reaplica.',
            dup_count, dup_sample;
    END IF;
END $$;

COMMIT;
