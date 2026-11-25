-- Apps — biblioteca de medios por tienda (apps-customization F1).
--
-- DATA IMPACT:
--   Tables affected:
--     store_app_media: tabla NUEVA (14 columnas), 1 FK a stores con ON DELETE
--       CASCADE y 2 índices. `app_media_kind_enum` es un tipo nuevo.
--   Expected row changes: 0. No UPDATE, no INSERT, no DELETE: las filas
--     existentes de otras tablas no se tocan.
--   Destructive operations: none (no DROP, no TRUNCATE). El borrado es lógico
--     (`deleted_at`); solo se pierde el registro si se borra la tienda, igual
--     que el resto de sus datos.
--   Idempotency: tipo y tabla con guarda `IF NOT EXISTS`; los índices también.

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
