-- QUI-657 — Activación fiscal sin certificado: cargar documentos de identidad.
--
-- DATA IMPACT:
-- Tables affected: dian_configurations (nueva columna), dian_configuration_documents (nueva tabla)
-- Expected row changes: NINGUNO. La columna nueva entra con DEFAULT 'not_required',
--   que es exactamente la semántica de toda fila histórica (el tenant trajo su
--   propio .p12 o todavía no trajo nada; en ninguno de los dos casos hay un
--   trámite de emisión abierto). No se reescribe ni una fila a mano.
-- Destructive operations: none. No DROP, no TRUNCATE, no DELETE, no ALTER de
--   enums existentes (dian_enablement_status_enum y certificate_source_enum
--   quedan intactos a propósito — son ejes ortogonales a este).
-- FK/cascade risk: el ON DELETE CASCADE está en la tabla NUEVA hacia
--   dian_configurations, es decir: borrar una configuración se lleva SUS
--   documentos. No se añade cascade a ninguna FK preexistente ni a ninguna
--   tabla padre de negocio. La FK a users es ON DELETE SET NULL para que el
--   documento sobreviva al usuario que lo cargó.
-- Idempotency: todo guardado con IF NOT EXISTS / DO $$ sobre pg_type.
-- Approval: decisiones de producto firmadas en QUI-657 (gratis por ahora,
--   retención indefinida, permiso superadmin:* reutilizado).

-- 1. Estado del certificado EN NUESTRA MANO. Ortogonal al estado ante la DIAN.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'certificate_provisioning_status_enum'
  ) THEN
    CREATE TYPE "certificate_provisioning_status_enum" AS ENUM (
      'not_required',
      'documents_pending',
      'documents_submitted',
      'issuing',
      'issued',
      'rejected'
    );
  END IF;
END $$;

-- 2. Columna en dian_configurations. NOT NULL con DEFAULT: Postgres la puebla
--    sin reescribir la tabla (default no volátil, PG >= 11).
ALTER TABLE "dian_configurations"
  ADD COLUMN IF NOT EXISTS "certificate_provisioning_status"
  "certificate_provisioning_status_enum" NOT NULL DEFAULT 'not_required';

-- 3. Documentos de identidad. Cuelgan de dian_configurations y NO de stores:
--    store_id es nullable por diseño (fiscal_scope = 'ORGANIZATION'), así que
--    colgar de stores dejaría sin hogar a las orgs de alcance-organización.
CREATE TABLE IF NOT EXISTS "dian_configuration_documents" (
  "id"                    SERIAL PRIMARY KEY,
  "dian_configuration_id" INTEGER      NOT NULL,
  "document_type"         VARCHAR(50)  NOT NULL,
  "s3_key"                TEXT         NOT NULL,
  "uploaded_by_user_id"   INTEGER,
  "uploaded_at"           TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "original_filename"     VARCHAR(255),
  "size_bytes"            BIGINT,
  "mime_type"             VARCHAR(100)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dian_configuration_documents_config_fkey'
  ) THEN
    ALTER TABLE "dian_configuration_documents"
      ADD CONSTRAINT "dian_configuration_documents_config_fkey"
      FOREIGN KEY ("dian_configuration_id")
      REFERENCES "dian_configurations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dian_configuration_documents_uploader_fkey'
  ) THEN
    ALTER TABLE "dian_configuration_documents"
      ADD CONSTRAINT "dian_configuration_documents_uploader_fkey"
      FOREIGN KEY ("uploaded_by_user_id")
      REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "dian_configuration_documents_dian_configuration_id_idx"
  ON "dian_configuration_documents" ("dian_configuration_id");

CREATE INDEX IF NOT EXISTS "dian_configuration_documents_dian_configuration_id_document_typ"
  ON "dian_configuration_documents" ("dian_configuration_id", "document_type");
