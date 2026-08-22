-- DATA IMPACT:
-- Tables affected:
--   · invoice_profiles          — CREADA vacía
--   · invoice_profile_versions  — CREADA vacía
--   · invoices                  — 2 columnas AGREGADAS (profile_id, profile_version)
-- Expected row changes: 0 filas leídas, 0 filas mutadas. Las dos tablas nacen
--   vacías y las dos columnas de `invoices` se agregan NULL SIN backfill: una
--   factura anterior a los perfiles no se calculó con ninguno, y afirmar que sí
--   sería falsear lo que el documento reproduce.
-- Destructive operations: NINGUNA. Sin DROP, sin TRUNCATE, sin CASCADE, sin
--   DELETE, sin UPDATE.
-- FK/cascade risk: ninguno. Toda FK nueva es ON DELETE RESTRICT salvo
--   `cloned_from_profile_id`, que es SET NULL porque el clon es un perfil
--   INDEPENDIENTE y borrar su origen no puede tocarlo. En particular NO se
--   declara ON DELETE CASCADE hacia `stores` ni `organizations` —a diferencia de
--   `invoices` e `invoice_resolutions`—: sería mentira, porque el RESTRICT de
--   `invoice_profile_versions` hacia el perfil bloquearía la cascada igual.
-- Idempotency: CREATE TABLE / INDEX con IF NOT EXISTS; ADD COLUMN con
--   IF NOT EXISTS; toda constraint dentro de un DO guardado por pg_constraint.
-- Approval: estructura nueva sin mutación de filas; no requiere aprobación de
--   datos por la regla global §6.3 (no modifica filas existentes).

-- ---------------------------------------------------------------------------
-- 1. La cabeza MUTABLE del perfil
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "invoice_profiles" (
    "id"                     SERIAL       NOT NULL,
    "organization_id"        INTEGER      NOT NULL,
    "store_id"               INTEGER      NOT NULL,
    "name"                   VARCHAR(150) NOT NULL,
    "operation_type"         VARCHAR(2)   NOT NULL,
    "state"                  VARCHAR(20)  NOT NULL DEFAULT 'active',
    "is_default"             BOOLEAN      NOT NULL DEFAULT false,
    "current_version"        INTEGER      NOT NULL DEFAULT 0,
    "cloned_from_profile_id" INTEGER,
    "cloned_from_version"    INTEGER,
    "created_by"             INTEGER,
    "created_at"             TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_profiles_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "invoice_profiles" IS
  'Cabeza mutable de una configuración fiscal. La configuración NO vive acá: vive en invoice_profile_versions, inmutable. Esta fila guarda sólo lo que puede cambiar sin alterar lo que una factura ya emitida reproduce.';
COMMENT ON COLUMN "invoice_profiles"."store_id" IS
  'NO nullable a propósito: el invariante es un solo predeterminado por (store_id, operation_type) y en Postgres dos NULL son DISTINTOS, así que una columna nullable admitiría dos predeterminados de ámbito organización del mismo tipo de operación.';
COMMENT ON COLUMN "invoice_profiles"."operation_type" IS
  'Código DIAN de tipo de operación (09 = AIU, 10 = estándar). VarChar y no enum: agregar un código nuevo a un enum exige ALTER TYPE ADD VALUE, que no puede compartir transacción con otras sentencias. La validación vive en el DTO contra DIAN_INVOICE_OPERATION_TYPES.';
COMMENT ON COLUMN "invoice_profiles"."state" IS
  'active | inactive. VarChar y no boolean: el ciclo de vida ya tiene una tercera posición con significado propio —no eliminable por tener facturas timbradas, INVOICING_PROFILE_003— y un boolean no admite una cuarta sin cambio de tipo.';
COMMENT ON COLUMN "invoice_profiles"."current_version" IS
  'Número de la última versión COMPROMETIDA. Arranca en 0, no en 1: un default de 1 afirmaría una versión que una transacción interrumpida nunca escribió. El 0 significa sin versión comprometida y es detectable como corrupción.';
COMMENT ON COLUMN "invoice_profiles"."cloned_from_profile_id" IS
  'Procedencia para el historial, no dependencia viva: clonar produce un perfil INDEPENDIENTE. De ahí el ON DELETE SET NULL.';

-- ---------------------------------------------------------------------------
-- 2. La versión INMUTABLE. Solo INSERT.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "invoice_profile_versions" (
    "id"         SERIAL       NOT NULL,
    "profile_id" INTEGER      NOT NULL,
    "version"    INTEGER      NOT NULL,
    "config"     JSONB        NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_profile_versions_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "invoice_profile_versions" IS
  'Versión inmutable de la configuración de un perfil. Nunca UPDATE ni DELETE: editar un perfil INSERTA una versión nueva. Si se pudiera editar, una factura timbrada dejaría de poder reproducir la configuración con la que se calculó.';
COMMENT ON COLUMN "invoice_profile_versions"."version" IS
  'Contiguo desde 1. Invariante: count(*) = max(version) por perfil; un hueco significaría una versión perdida y con ella la reproducibilidad de las facturas que la referencian.';
COMMENT ON COLUMN "invoice_profile_versions"."config" IS
  'Snapshot completo de configuración. Su forma es un CONTRATO FISCAL, no una preferencia de UI: si omite algo que la emisión necesita, la emisión vuelve a leer configuración viva y reabre el defecto que el congelado cierra.';

-- ---------------------------------------------------------------------------
-- 3. Columnas en `invoices`: la factura referencia una VERSIÓN, no un perfil
-- ---------------------------------------------------------------------------
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "profile_id"      INTEGER;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "profile_version" INTEGER;

COMMENT ON COLUMN "invoices"."profile_id" IS
  'Junto con profile_version apunta a invoice_profile_versions por su único (profile_id, version), NO al perfil: lo que una factura debe poder reproducir es la configuración con la que se calculó, y el perfil es mutable. NULL en toda factura anterior a los perfiles; no se hizo backfill porque no se calcularon con ninguno.';
COMMENT ON COLUMN "invoices"."profile_version" IS
  'Ver profile_id. El "ambas o ninguna" lo impone el CHECK invoices_profile_pair_complete, porque una FK multi-columna con MATCH SIMPLE no se verifica si cualquiera de las columnas es NULL.';

-- ---------------------------------------------------------------------------
-- 4. Únicos e índices
-- ---------------------------------------------------------------------------

-- El único PARCIAL que sostiene "un solo predeterminado por tipo de operación".
-- Prisma NO puede representarlo: vive únicamente acá. No lo borres creyendo que
-- el esquema lo cubre.
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_profiles_one_default_per_operation_type"
    ON "invoice_profiles" ("store_id", "operation_type")
    WHERE "is_default";

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_profile_versions_profile_id_version_key"
    ON "invoice_profile_versions" ("profile_id", "version");

CREATE INDEX IF NOT EXISTS "invoice_profiles_store_id_state_operation_type_idx"
    ON "invoice_profiles" ("store_id", "state", "operation_type");
CREATE INDEX IF NOT EXISTS "invoice_profiles_organization_id_idx"
    ON "invoice_profiles" ("organization_id");
CREATE INDEX IF NOT EXISTS "invoice_profiles_cloned_from_profile_id_idx"
    ON "invoice_profiles" ("cloned_from_profile_id");
CREATE INDEX IF NOT EXISTS "invoice_profile_versions_profile_id_created_at_idx"
    ON "invoice_profile_versions" ("profile_id", "created_at");

-- Postgres no indexa el ORIGEN de una FK: sin esto, borrar o actualizar una
-- versión escanearía `invoices` entera para verificar el RESTRICT.
CREATE INDEX IF NOT EXISTS "invoices_profile_id_profile_version_idx"
    ON "invoices" ("profile_id", "profile_version");

-- ---------------------------------------------------------------------------
-- 5. CHECKs — lo que la FK no puede decir
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_profiles_state_valid') THEN
    ALTER TABLE "invoice_profiles" ADD CONSTRAINT "invoice_profiles_state_valid"
      CHECK ("state" IN ('active', 'inactive'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_profiles_current_version_non_negative') THEN
    ALTER TABLE "invoice_profiles" ADD CONSTRAINT "invoice_profiles_current_version_non_negative"
      CHECK ("current_version" >= 0);
  END IF;

  -- Ambas o ninguna: una procedencia con perfil pero sin versión no identifica
  -- de qué se clonó.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_profiles_clone_pair_complete') THEN
    ALTER TABLE "invoice_profiles" ADD CONSTRAINT "invoice_profiles_clone_pair_complete"
      CHECK (("cloned_from_profile_id" IS NULL) = ("cloned_from_version" IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_profiles_not_self_clone') THEN
    ALTER TABLE "invoice_profiles" ADD CONSTRAINT "invoice_profiles_not_self_clone"
      CHECK ("cloned_from_profile_id" IS NULL OR "cloned_from_profile_id" <> "id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_profile_versions_version_positive') THEN
    ALTER TABLE "invoice_profile_versions" ADD CONSTRAINT "invoice_profile_versions_version_positive"
      CHECK ("version" >= 1);
  END IF;

  -- LA constraint que la FK compuesta no puede sustituir. Con MATCH SIMPLE (el
  -- default de Postgres) una FK multi-columna NO se verifica si cualquiera de
  -- sus columnas es NULL, así que (profile_id = 5, profile_version = NULL)
  -- pasaría la FK y dejaría una factura afirmando un perfil sin versión.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_profile_pair_complete') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_profile_pair_complete"
      CHECK (("profile_id" IS NULL) = ("profile_version" IS NULL));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. FKs — toda la cadena en RESTRICT salvo la procedencia del clon
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_profiles_organization_id_fkey') THEN
    ALTER TABLE "invoice_profiles" ADD CONSTRAINT "invoice_profiles_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_profiles_store_id_fkey') THEN
    ALTER TABLE "invoice_profiles" ADD CONSTRAINT "invoice_profiles_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_profiles_created_by_fkey') THEN
    ALTER TABLE "invoice_profiles" ADD CONSTRAINT "invoice_profiles_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_profiles_cloned_from_profile_id_fkey') THEN
    ALTER TABLE "invoice_profiles" ADD CONSTRAINT "invoice_profiles_cloned_from_profile_id_fkey"
      FOREIGN KEY ("cloned_from_profile_id") REFERENCES "invoice_profiles"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_profile_versions_profile_id_fkey') THEN
    ALTER TABLE "invoice_profile_versions" ADD CONSTRAINT "invoice_profile_versions_profile_id_fkey"
      FOREIGN KEY ("profile_id") REFERENCES "invoice_profiles"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_profile_versions_created_by_fkey') THEN
    ALTER TABLE "invoice_profile_versions" ADD CONSTRAINT "invoice_profile_versions_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  -- La factura apunta a la VERSIÓN, por su único (profile_id, version).
  -- RESTRICT: una versión referenciada por una factura no se puede borrar, que es
  -- la red de base que sostiene INVOICING_PROFILE_003.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_profile_snapshot_fkey') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_profile_snapshot_fkey"
      FOREIGN KEY ("profile_id", "profile_version")
      REFERENCES "invoice_profile_versions"("profile_id", "version")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
