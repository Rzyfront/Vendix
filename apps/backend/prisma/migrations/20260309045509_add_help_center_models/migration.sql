-- CreateEnum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'help_article_type_enum') THEN
    CREATE TYPE "help_article_type_enum" AS ENUM ('TUTORIAL', 'FAQ', 'GUIDE', 'ANNOUNCEMENT', 'RELEASE_NOTE');
  END IF;
END
$$;

-- CreateEnum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'help_article_status_enum') THEN
    CREATE TYPE "help_article_status_enum" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
  END IF;
END
$$;

-- CreateTable
CREATE TABLE "help_article_categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "icon" VARCHAR(50),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "help_article_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "help_articles" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(280) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "type" "help_article_type_enum" NOT NULL DEFAULT 'GUIDE',
    "status" "help_article_status_enum" NOT NULL DEFAULT 'DRAFT',
    "category_id" INTEGER NOT NULL,
    "module" VARCHAR(50),
    "tags" TEXT[],
    "cover_image_url" TEXT,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" INTEGER,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "help_articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "help_article_categories_slug_key" ON "help_article_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "help_articles_slug_key" ON "help_articles"("slug");

-- CreateIndex
CREATE INDEX "help_articles_category_id_idx" ON "help_articles"("category_id");

-- CreateIndex
CREATE INDEX "help_articles_status_idx" ON "help_articles"("status");

-- CreateIndex
CREATE INDEX "help_articles_type_idx" ON "help_articles"("type");

-- CreateIndex
CREATE INDEX "help_articles_module_idx" ON "help_articles"("module");

-- CreateIndex
CREATE INDEX "help_articles_is_featured_idx" ON "help_articles"("is_featured");

-- CreateIndex
CREATE INDEX "help_articles_created_by_id_idx" ON "help_articles"("created_by_id");

-- AddForeignKey
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "help_article_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
