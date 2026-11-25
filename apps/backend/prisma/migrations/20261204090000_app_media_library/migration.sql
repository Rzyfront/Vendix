-- Apps — biblioteca de medios por tienda (apps-customization F1).
-- Aditiva e idempotente: el tipo y la tabla solo se crean si no existen.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_media_kind_enum') THEN
    CREATE TYPE "app_media_kind_enum" AS ENUM ('image', 'document');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "store_app_media" (
  "id" SERIAL PRIMARY KEY,
  "store_id" INTEGER NOT NULL,
  "app_kind" "app_kind_enum",
  "kind" "app_media_kind_enum" NOT NULL DEFAULT 'image',
  "s3_key" VARCHAR(512) NOT NULL,
  "thumb_key" VARCHAR(512),
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "alt" VARCHAR(200),
  "deleted_at" TIMESTAMPTZ(6),
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "store_app_media_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "store_app_media_store_id_app_kind_idx"
  ON "store_app_media" ("store_id", "app_kind");
CREATE INDEX IF NOT EXISTS "store_app_media_store_id_created_at_idx"
  ON "store_app_media" ("store_id", "created_at");
