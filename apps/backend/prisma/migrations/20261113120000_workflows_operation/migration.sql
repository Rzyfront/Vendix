-- flujos-documental S8 (bloque 8): operación de Flujos — comentarios de la
-- solicitud y enlaces públicos de formulario.
--
-- DATA IMPACT:
-- Tables affected: workflow_instance_comments, workflow_public_links (ambas NUEVAS).
-- Expected row changes: +0 (solo esquema; ninguna fila existente se lee ni se muta).
-- Destructive operations: none (sin DROP / TRUNCATE / UPDATE / DELETE).
-- FK/cascade risk: FKs nuevas hacia organizations / stores / users /
--   workflow_instances / workflow_definitions, todas ON DELETE RESTRICT;
--   ningún CASCADE sobre padres de negocio.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, FKs guardadas por pg_constraint.
-- Skill: vendix-prisma-migrations.

-- CreateTable
CREATE TABLE IF NOT EXISTS "workflow_instance_comments" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "author_user_id" INTEGER NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_instance_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workflow_public_links" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "definition_id" INTEGER NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(6),
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(6),

    CONSTRAINT "workflow_public_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_instance_comments_instance_id_created_at_idx" ON "workflow_instance_comments"("instance_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_instance_comments_store_id_idx" ON "workflow_instance_comments"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_public_links_token_hash_key" ON "workflow_public_links"("token_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_public_links_store_id_definition_id_is_active_idx" ON "workflow_public_links"("store_id", "definition_id", "is_active");

-- Un enlace activo por flujo (índice parcial; Prisma no lo modela, la regla se
-- aplica también en el servicio dentro de la transacción de rotación).
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_public_links_one_active_per_definition" ON "workflow_public_links"("definition_id") WHERE "is_active" = true;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instance_comments_organization_id_fkey') THEN
    ALTER TABLE "workflow_instance_comments" ADD CONSTRAINT "workflow_instance_comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instance_comments_store_id_fkey') THEN
    ALTER TABLE "workflow_instance_comments" ADD CONSTRAINT "workflow_instance_comments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instance_comments_instance_id_fkey') THEN
    ALTER TABLE "workflow_instance_comments" ADD CONSTRAINT "workflow_instance_comments_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "workflow_instances"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instance_comments_author_user_id_fkey') THEN
    ALTER TABLE "workflow_instance_comments" ADD CONSTRAINT "workflow_instance_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_public_links_organization_id_fkey') THEN
    ALTER TABLE "workflow_public_links" ADD CONSTRAINT "workflow_public_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_public_links_store_id_fkey') THEN
    ALTER TABLE "workflow_public_links" ADD CONSTRAINT "workflow_public_links_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_public_links_definition_id_fkey') THEN
    ALTER TABLE "workflow_public_links" ADD CONSTRAINT "workflow_public_links_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_public_links_created_by_user_id_fkey') THEN
    ALTER TABLE "workflow_public_links" ADD CONSTRAINT "workflow_public_links_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
