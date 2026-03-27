-- ============================================================
-- Migration: Reviews & Ratings System
-- Description: Extend reviews model, add review_responses,
--              review_votes, review_reports tables
-- ============================================================

-- 1. Create review_report_status enum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_report_status') THEN
    CREATE TYPE "review_report_status" AS ENUM ('pending', 'reviewed', 'dismissed');
  END IF;
END
$$;

-- 2. Add new values to notification_type_enum (idempotent)
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'new_review';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'review_moderated';

-- 3. Clean up any null data in existing reviews before making columns NOT NULL
DELETE FROM "reviews" WHERE "product_id" IS NULL OR "user_id" IS NULL OR "rating" IS NULL;

-- 4. Add new columns to reviews (idempotent)
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "store_id" INTEGER;
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "title" VARCHAR(255);
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "verified_purchase" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "helpful_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "report_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

-- 5. Backfill store_id from products table
UPDATE "reviews" SET "store_id" = (
  SELECT "store_id" FROM "products" WHERE "products"."id" = "reviews"."product_id"
) WHERE "store_id" IS NULL AND "product_id" IS NOT NULL;

-- 6. Make columns NOT NULL (after backfill)
ALTER TABLE "reviews" ALTER COLUMN "store_id" SET NOT NULL;
ALTER TABLE "reviews" ALTER COLUMN "product_id" SET NOT NULL;
ALTER TABLE "reviews" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "reviews" ALTER COLUMN "rating" SET NOT NULL;

-- 7. Change comment from nullable to NOT NULL with text type
ALTER TABLE "reviews" ALTER COLUMN "comment" SET NOT NULL;
ALTER TABLE "reviews" ALTER COLUMN "comment" TYPE TEXT;

-- 8. Add foreign key for store_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'reviews_store_id_fkey'
  ) THEN
    ALTER TABLE "reviews" ADD CONSTRAINT "reviews_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- 9. Add indexes (idempotent)
CREATE INDEX IF NOT EXISTS "reviews_store_id_idx" ON "reviews"("store_id");
CREATE INDEX IF NOT EXISTS "reviews_product_id_state_idx" ON "reviews"("product_id", "state");
CREATE INDEX IF NOT EXISTS "reviews_user_id_idx" ON "reviews"("user_id");

-- 10. Add unique constraint (user can only review a product once)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'reviews_user_id_product_id_key'
  ) THEN
    ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_product_id_key" UNIQUE ("user_id", "product_id");
  END IF;
END
$$;

-- 11. Create review_responses table
CREATE TABLE IF NOT EXISTS "review_responses" (
  "id" SERIAL NOT NULL,
  "review_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),

  CONSTRAINT "review_responses_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'review_responses_review_id_key'
  ) THEN
    ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_review_id_key" UNIQUE ("review_id");
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'review_responses_review_id_fkey'
  ) THEN
    ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_review_id_fkey"
      FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'review_responses_user_id_fkey'
  ) THEN
    ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END
$$;

-- 12. Create review_votes table
CREATE TABLE IF NOT EXISTS "review_votes" (
  "id" SERIAL NOT NULL,
  "review_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "is_helpful" BOOLEAN NOT NULL,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "review_votes_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'review_votes_review_id_user_id_key'
  ) THEN
    ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_review_id_user_id_key" UNIQUE ("review_id", "user_id");
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "review_votes_review_id_idx" ON "review_votes"("review_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'review_votes_review_id_fkey'
  ) THEN
    ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_review_id_fkey"
      FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'review_votes_user_id_fkey'
  ) THEN
    ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END
$$;

-- 13. Create review_reports table
CREATE TABLE IF NOT EXISTS "review_reports" (
  "id" SERIAL NOT NULL,
  "review_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "status" "review_report_status" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'review_reports_review_id_user_id_key'
  ) THEN
    ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_user_id_key" UNIQUE ("review_id", "user_id");
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "review_reports_review_id_idx" ON "review_reports"("review_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'review_reports_review_id_fkey'
  ) THEN
    ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_fkey"
      FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'review_reports_user_id_fkey'
  ) THEN
    ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END
$$;
