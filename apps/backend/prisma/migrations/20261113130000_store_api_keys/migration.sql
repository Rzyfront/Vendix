-- flujos-documental S13 (bloque 13): API keys por tienda para /api/v1/workflows.
-- Tabla nueva `store_api_keys` (no se reutiliza `api_keys`, que no tiene tenant
-- ni lector). Solo se guarda el sha256 de la clave; el secreto se muestra una vez.
--
-- DATA IMPACT:
-- Tables affected: store_api_keys (NUEVA).
-- Expected row changes: +0 (solo esquema; ninguna fila existente se lee ni se muta).
-- Destructive operations: none (sin DROP / TRUNCATE / UPDATE / DELETE).
-- FK/cascade risk: FKs nuevas hacia organizations / stores / users, todas
--   ON DELETE RESTRICT; ningún CASCADE sobre padres de negocio.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, FKs guardadas por pg_constraint.
-- Skill: vendix-prisma-migrations.

-- CreateTable
CREATE TABLE IF NOT EXISTS "store_api_keys" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_user_id" INTEGER NOT NULL,
    "acting_user_id" INTEGER NOT NULL,
    "last_used_at" TIMESTAMP(6),
    "last_used_ip" VARCHAR(64),
    "expires_at" TIMESTAMP(6),
    "revoked_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "store_api_keys_key_hash_key" ON "store_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "store_api_keys_store_id_idx" ON "store_api_keys"("store_id");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_api_keys_organization_id_fkey') THEN
    ALTER TABLE "store_api_keys" ADD CONSTRAINT "store_api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_api_keys_store_id_fkey') THEN
    ALTER TABLE "store_api_keys" ADD CONSTRAINT "store_api_keys_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_api_keys_created_by_user_id_fkey') THEN
    ALTER TABLE "store_api_keys" ADD CONSTRAINT "store_api_keys_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_api_keys_acting_user_id_fkey') THEN
    ALTER TABLE "store_api_keys" ADD CONSTRAINT "store_api_keys_acting_user_id_fkey" FOREIGN KEY ("acting_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
