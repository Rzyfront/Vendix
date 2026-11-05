-- flujos-documental S5 (T5): núcleo documental D1 — archivos almacenados,
-- expedientes y elementos de expediente.
--
-- DATA IMPACT:
-- Tables affected: stored_files, dossiers, dossier_items (todas NUEVAS).
-- Expected row changes: +0 (solo esquema; ninguna fila existente se lee ni se muta).
-- Destructive operations: none (sin DROP / TRUNCATE / UPDATE / DELETE).
-- FK/cascade risk: FKs nuevas hacia organizations / stores / workflow_instances /
--   stored_files / dossiers con ON DELETE RESTRICT (o SET NULL en la cadena de
--   reemplazo); ningún CASCADE sobre padres de negocio.
-- Idempotency: CREATE TYPE guardado por pg_type, CREATE TABLE/INDEX IF NOT EXISTS,
--   FKs guardadas por pg_constraint.
-- Skill: vendix-prisma-migrations.

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stored_file_source_enum') THEN
    CREATE TYPE "stored_file_source_enum" AS ENUM ('upload', 'generated', 'public_form');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dossier_item_kind_enum') THEN
    CREATE TYPE "dossier_item_kind_enum" AS ENUM ('uploaded_file', 'note');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dossier_item_status_enum') THEN
    CREATE TYPE "dossier_item_status_enum" AS ENUM ('received', 'validated', 'rejected', 'superseded');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "stored_files" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "s3_key" VARCHAR(512) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "source" "stored_file_source_enum" NOT NULL DEFAULT 'upload',
    "uploaded_by_type" "workflow_actor_type_enum" NOT NULL,
    "uploaded_by_id" INTEGER,
    "retention_until" TIMESTAMP(6),
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dossiers" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "subject_type" VARCHAR(40),
    "subject_id" INTEGER,
    "workflow_instance_id" INTEGER,
    "closed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dossiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dossier_items" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "dossier_id" INTEGER NOT NULL,
    "kind" "dossier_item_kind_enum" NOT NULL,
    "requirement_key" VARCHAR(80),
    "stage_key" VARCHAR(80),
    "field_key" VARCHAR(80),
    "file_id" INTEGER,
    "note" TEXT,
    "status" "dossier_item_status_enum" NOT NULL DEFAULT 'received',
    "supersedes_id" INTEGER,
    "added_by_type" "workflow_actor_type_enum" NOT NULL,
    "added_by_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dossier_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "stored_files_s3_key_key" ON "stored_files"("s3_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stored_files_store_id_sha256_idx" ON "stored_files"("store_id","sha256");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "dossiers_workflow_instance_id_key" ON "dossiers"("workflow_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "dossiers_store_id_reference_key" ON "dossiers"("store_id","reference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dossiers_store_id_subject_type_subject_id_idx" ON "dossiers"("store_id","subject_type","subject_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dossier_items_dossier_id_requirement_key_idx" ON "dossier_items"("dossier_id","requirement_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dossier_items_store_id_file_id_idx" ON "dossier_items"("store_id","file_id");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stored_files_organization_id_fkey') THEN
    ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stored_files_store_id_fkey') THEN
    ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dossiers_organization_id_fkey') THEN
    ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dossiers_store_id_fkey') THEN
    ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dossiers_workflow_instance_id_fkey') THEN
    ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dossier_items_store_id_fkey') THEN
    ALTER TABLE "dossier_items" ADD CONSTRAINT "dossier_items_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dossier_items_dossier_id_fkey') THEN
    ALTER TABLE "dossier_items" ADD CONSTRAINT "dossier_items_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dossier_items_file_id_fkey') THEN
    ALTER TABLE "dossier_items" ADD CONSTRAINT "dossier_items_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dossier_items_supersedes_id_fkey') THEN
    ALTER TABLE "dossier_items" ADD CONSTRAINT "dossier_items_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "dossier_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
