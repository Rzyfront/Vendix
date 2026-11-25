-- Apps · medios: identificador opaco de la URL pública (apps-customization F1.1).
-- Migración aparte y aditiva: si la tabla ya se creó sin la columna, esto la
-- agrega sin tocar migraciones ya aplicadas.
ALTER TABLE "store_app_media"
  ADD COLUMN IF NOT EXISTS "public_token" UUID;

-- Las filas existentes (si las hubiera) reciben un token único.
UPDATE "store_app_media"
  SET "public_token" = gen_random_uuid()
  WHERE "public_token" IS NULL;

ALTER TABLE "store_app_media"
  ALTER COLUMN "public_token" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "store_app_media_public_token_key"
  ON "store_app_media" ("public_token");
