-- DATA IMPACT:
-- Tables affected:
--   · invoice_profiles — 1 columna MODIFICADA (drop NOT NULL on store_id),
--                        1 FK RECREADA (preserva Restrict), 1 índice único
--                        parcial DROP+CREATE (dual-scope), 1 CHECK constraint
--                        NUEVO (organization_id IS NOT NULL).
--   · invoice_profile_versions — sin cambios (FK intacta).
-- Expected row changes: 0 filas mutadas en TODA la migración. Es DDL puro.
--   La columna store_id pasa de NOT NULL a nullable: ningún valor cambia,
--   ninguna fila se reescribe. Los índices parciales duales recrean el
--   espacio de claves de la parcial anterior más uno nuevo sin filas
--   (la parcial org-scope nace vacía porque hoy no hay perfiles con
--   store_id IS NULL — son el primer dominio que estamos abriendo).
-- Destructive operations: NINGUNA. Sin DROP TABLE, sin TRUNCATE, sin
--   CASCADE, sin DELETE, sin UPDATE.
-- FK/cascade risk: la FK invoice_profiles.organization_id → organizations(id)
--   queda con su ON DELETE actual (Restrict). La FK invoice_profiles.store_id
--   → stores(id) se DROP+CREATE explícitamente para preservar su
--   Restrict al pasar la columna a nullable — Postgres no permite alterar
--   la nulabilidad de una columna que participa en una FK sin recrearla.
-- Idempotency: todos los pasos usan pg_constraint / pg_index / IF EXISTS /
--   IF NOT EXISTS; re-ejecutable.
-- Snapshot de prod: OBLIGATORIO antes de aplicar. Tablas a volcar:
--   `invoice_profiles`, `invoice_profile_versions`. Guardar dump y hash
--   SHA en la nota de release del PR.
--
-- PUEDE FALLAR EL DEPLOY si al momento de aplicarse existieran dos
-- perfiles con store_id IS NULL en la misma (organization_id,
-- operation_type) marcados como predeterminado. La parcial org-scope
-- abortaría con violación de unicidad. A la fecha de escritura esos
-- perfiles no existen — la parcial store-scope no los admite — pero
-- el guard de idempotencia los nombraría si llegaran a existir al
-- rearrancar o reaplicar.

BEGIN;

-- 1. Relaja NOT NULL sobre store_id para que perfiles de ámbito
--    organización (store_id IS NULL) puedan anclarse a organization_id
--    exclusivamente, igual que dian_configurations (migración
--    20260511160000_relax_dian_store_id_for_org_scope) e
--    invoice_resolutions (schema:5786).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_profiles'
      AND column_name = 'store_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "invoice_profiles"
      ALTER COLUMN "store_id" DROP NOT NULL;
  END IF;
END $$;

-- 2. Recrea la FK store_id → stores(id) para preservar su ON DELETE
--    Restrict. Postgres rechaza ALTER COLUMN DROP NOT NULL sobre una
--    columna con FK si no se recrea la FK en el mismo cambio.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_profiles_store_id_fkey'
      AND conrelid = '"invoice_profiles"'::regclass
  ) THEN
    ALTER TABLE "invoice_profiles"
      DROP CONSTRAINT "invoice_profiles_store_id_fkey";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_profiles_store_id_fkey'
      AND conrelid = '"invoice_profiles"'::regclass
  ) THEN
    ALTER TABLE "invoice_profiles"
      ADD CONSTRAINT "invoice_profiles_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- 3. DROP la parcial antigua. Cubría (store_id, operation_type) WHERE
--    is_default pero NO puede cubrir filas con store_id IS NULL (la
--    parcial actual ignora NULLs en store_id por la semántica de
--    Postgres: dos NULL son distintos, así que el predicado WHERE is_default
--    admitiría múltiples defaults org-scoped). Reemplazamos por dos
--    parciales que diferencian explícitamente STORE-scope y ORG-scope.
DROP INDEX IF EXISTS "invoice_profiles_one_default_per_operation_type";

-- 4. Parciales duales — el mismo patrón que dian_configurations_org_scope_uq
--    (:34 de la migración 20260511160000) y que la docblock del esquema
--    reconoce como el precedente del repo.
--    Store-scoped: único por (store_id, operation_type) cuando
--    store_id IS NOT NULL. Abarca exactamente las filas que la parcial
--    antigua cubría — sin regresión funcional para tiendas.
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_profiles_store_scope_default_uq"
  ON "invoice_profiles" ("store_id", "operation_type")
  WHERE "is_default" AND "store_id" IS NOT NULL;

--    Org-scoped: único por (organization_id, operation_type) cuando
--    store_id IS NULL. Nace vacía porque no hay perfiles org-scoped
--    aún; el primer perfil plataforma que se cree con is_default=true
--    la ocupa y un segundo para el mismo op_type violaría la unicidad.
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_profiles_org_scope_default_uq"
  ON "invoice_profiles" ("organization_id", "operation_type")
  WHERE "is_default" AND "store_id" IS NULL;

-- 5. CHECK: organization_id siempre requerido, store_id gobernado por
--    organizations.fiscal_scope (STORE ⇒ NOT NULL implícito por lógica
--    de negocio y por la parcial store; ORGANIZATION ⇒ NULL válido).
--    El invariante «toda fila está anclada a una organización» lo
--    garantiza la base, no el código.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_profiles_scope_org_chk'
      AND conrelid = '"invoice_profiles"'::regclass
  ) THEN
    ALTER TABLE "invoice_profiles"
      ADD CONSTRAINT "invoice_profiles_scope_org_chk"
      CHECK ("organization_id" IS NOT NULL);
  END IF;
END $$;

-- 6. Idempotencia del predicado: si al re-aplicar la migración existieran
--    dos perfiles con store_id IS NULL en la misma (organization_id,
--    operation_type) marcados como predeterminado, la parcial org_scope
--    abortaría con violación de unicidad. Nombramos aquí los afectados
--    para que el operador sepa qué fila revisar. Hoy no hay ninguno;
--    este guard existe para el día del rearranque sobre datos cargados.
DO $$
DECLARE
    dup_count integer;
    dup_sample text;
BEGIN
    SELECT count(*), string_agg(detalle, '; ')
      INTO dup_count, dup_sample
      FROM (
        SELECT format('org=%s op_type=%s (%s ids %s)',
                      "organization_id", "operation_type", count(*),
                      string_agg(id::text, ',' ORDER BY id)) AS detalle
          FROM "invoice_profiles"
         WHERE "is_default" AND "store_id" IS NULL
         GROUP BY "organization_id", "operation_type"
        HAVING count(*) > 1
         LIMIT 10
      ) AS duplicados;

    IF COALESCE(dup_count, 0) > 0 THEN
        RAISE EXCEPTION
            'No se puede crear la parcial org-scope de invoice_profiles: % grupo(s) de defaults duplicados en el mismo (organization_id, operation_type) con store_id IS NULL. %',
            dup_count, dup_sample;
    END IF;
END $$;

COMMIT;
