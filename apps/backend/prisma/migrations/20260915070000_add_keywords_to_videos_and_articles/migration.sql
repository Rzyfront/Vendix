-- AlterTable
ALTER TABLE "help_articles" ADD COLUMN IF NOT EXISTS "keywords" TEXT[] NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "keywords" TEXT[] NOT NULL DEFAULT '{}';
