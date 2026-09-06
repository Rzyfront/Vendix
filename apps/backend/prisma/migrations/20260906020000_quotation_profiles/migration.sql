-- B.1 — Perfiles de cotizacion opcionales por store (ADR-03, DB-02, DB-03).
-- Tablas nuevas `quotation_profiles` + `quotation_profile_versions`,
-- espejo simplificado de `invoice_profiles` (sin rail de organizacion ni
-- tipos DIAN): nombre unico por store, un solo `is_default` por store,
-- historial append-only de `config` JSON. `quotations.profile_id` nullable
-- (quien no usa perfiles cotiza desde cero; cero efecto en filas existentes).
--
-- DATA IMPACT:
-- Tables affected:
--   · quotation_profiles          — CREADA vacía
--   · quotation_profile_versions  — CREADA vacía
--   · quotations                  — 1 columna AGREGADA (profile_id, nullable)
-- Expected row changes: 0 filas leídas, 0 filas mutadas. Las dos tablas nacen
--   vacías y `quotations.profile_id` se agrega NULL SIN backfill: una
--   cotización anterior a los perfiles no se citó con ninguno, y afirmar que
--   sí sería falsear lo que el documento reproduce.
-- Destructive operations: NINGUNA. Sin DROP, sin TRUNCATE, sin CASCADE, sin
--   DELETE, sin UPDATE.
-- FK/cascade risk: ninguno. Toda FK nueva es ON DELETE RESTRICT salvo
--   `cloned_from_profile_id`, que es SET NULL porque el clon es un perfil
--   INDEPENDIENTE y borrar su origen no puede tocarlo.
-- Idempotency: CREATE TABLE / INDEX con IF NOT EXISTS; ADD COLUMN con
--   IF NOT EXISTS; toda constraint dentro de un DO guardado por pg_constraint.
-- Approval: CP-quotation-contract-aiu paso B.1
-- Rollback: revertir antes de datos nuevos; con uso, migracion compensa
--   (ver Data Integrity Plan del plan)

-- ---------------------------------------------------------------------------
-- 1. La cabeza MUTABLE del perfil
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "quotation_profiles" (
    "id"                     SERIAL       NOT NULL,
    "organization_id"        INTEGER      NOT NULL,
    "store_id"               INTEGER      NOT NULL,
    "name"                   VARCHAR(150) NOT NULL,
    "state"                  VARCHAR(20)  NOT NULL DEFAULT 'active',
    "is_default"             BOOLEAN      NOT NULL DEFAULT false,
    "current_version"        INTEGER      NOT NULL DEFAULT 0,
    "cloned_from_profile_id" INTEGER,
    "cloned_from_version"    INTEGER,
    "created_by"             INTEGER,
    "created_at"             TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quotation_profiles_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 2. La versión INMUTABLE. Solo INSERT.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "quotation_profile_versions" (
    "id"         SERIAL       NOT NULL,
    "profile_id" INTEGER      NOT NULL,
    "version"    INTEGER      NOT NULL,
    "config"     JSONB        NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quotation_profile_versions_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3. Columna en `quotations`: la cotización referencia un PERFIL, no una
-- versión (el congelado de la versión lo hace C.1 en el contrato, ADR-03).
-- ---------------------------------------------------------------------------
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "profile_id" INTEGER;

-- ---------------------------------------------------------------------------
-- 4. Índices: nombre único por store (sobre expresión, igual que
-- `invoice_profiles_unique_name_per_store`), un solo default por store
-- (parcial), unicidad de versión por perfil. No colapsan espacios: la
-- normalización vive en el DTO/servicio (`quotation-profile-name.ts`).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "quotation_profiles_unique_name_per_store"
  ON "quotation_profiles"("store_id", lower("name"));

CREATE UNIQUE INDEX IF NOT EXISTS "quotation_profiles_store_default_uq"
  ON "quotation_profiles"("store_id") WHERE "is_default";

CREATE UNIQUE INDEX IF NOT EXISTS "quotation_profile_versions_profile_version_uq"
  ON "quotation_profile_versions"("profile_id", "version");

CREATE INDEX IF NOT EXISTS "quotation_profiles_store_state_idx"
  ON "quotation_profiles"("store_id", "state");
CREATE INDEX IF NOT EXISTS "quotation_profiles_organization_idx"
  ON "quotation_profiles"("organization_id");
CREATE INDEX IF NOT EXISTS "quotation_profiles_cloned_from_idx"
  ON "quotation_profiles"("cloned_from_profile_id");
CREATE INDEX IF NOT EXISTS "quotation_profile_versions_profile_created_idx"
  ON "quotation_profile_versions"("profile_id", "created_at");
CREATE INDEX IF NOT EXISTS "quotations_profile_id_idx"
  ON "quotations"("profile_id");

-- ---------------------------------------------------------------------------
-- 5. FKs, guardadas por catálogo para ser reejecutables. Todas RESTRICT
-- salvo la procedencia del clon: borrar con historial referenciado se
-- bloquea en vez de arrastrar (el servicio responde 409 con código).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotation_profiles_organization_id_fkey') THEN
    ALTER TABLE "quotation_profiles" ADD CONSTRAINT "quotation_profiles_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotation_profiles_store_id_fkey') THEN
    ALTER TABLE "quotation_profiles" ADD CONSTRAINT "quotation_profiles_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotation_profiles_created_by_fkey') THEN
    ALTER TABLE "quotation_profiles" ADD CONSTRAINT "quotation_profiles_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotation_profiles_cloned_from_fkey') THEN
    ALTER TABLE "quotation_profiles" ADD CONSTRAINT "quotation_profiles_cloned_from_fkey"
      FOREIGN KEY ("cloned_from_profile_id") REFERENCES "quotation_profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotation_profile_versions_profile_id_fkey') THEN
    ALTER TABLE "quotation_profile_versions" ADD CONSTRAINT "quotation_profile_versions_profile_id_fkey"
      FOREIGN KEY ("profile_id") REFERENCES "quotation_profiles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotation_profile_versions_created_by_fkey') THEN
    ALTER TABLE "quotation_profile_versions" ADD CONSTRAINT "quotation_profile_versions_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotations_profile_id_fkey') THEN
    ALTER TABLE "quotations" ADD CONSTRAINT "quotations_profile_id_fkey"
      FOREIGN KEY ("profile_id") REFERENCES "quotation_profiles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
