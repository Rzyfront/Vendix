-- DATA IMPACT:
-- Tables affected: video_categories, videos
-- Expected row changes: new empty tables for the video library module
-- Destructive operations: none (CREATE TYPE IF NOT EXISTS, CREATE TABLE IF NOT EXISTS)
-- FK/cascade risk: none (FKs link to video_categories and users on delete set null)
-- Idempotency: DO $$ blocks protect against duplicate types/constraints; IF NOT EXISTS on tables and indexes.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "video_source_type_enum" AS ENUM ('YOUTUBE', 'VIMEO', 'LOOM', 'DIRECT_S3');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "video_status_enum" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "video_categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "icon" VARCHAR(50),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "videos" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(280) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "video_url" TEXT NOT NULL,
    "video_source" "video_source_type_enum" NOT NULL DEFAULT 'YOUTUBE',
    "external_id" VARCHAR(100),
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "thumbnail_url" TEXT,
    "status" "video_status_enum" NOT NULL DEFAULT 'DRAFT',
    "category_id" INTEGER NOT NULL,
    "module" VARCHAR(50),
    "tags" TEXT[],
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" INTEGER,
    "store_id" INTEGER,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "video_categories_slug_key" ON "video_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "videos_slug_key" ON "videos"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "videos_category_id_idx" ON "videos"("category_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "videos_status_idx" ON "videos"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "videos_video_source_idx" ON "videos"("video_source");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "videos_module_idx" ON "videos"("module");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "videos_is_featured_idx" ON "videos"("is_featured");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "videos_created_by_id_idx" ON "videos"("created_by_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "videos_store_id_idx" ON "videos"("store_id");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "videos" ADD CONSTRAINT "videos_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "video_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "videos" ADD CONSTRAINT "videos_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
