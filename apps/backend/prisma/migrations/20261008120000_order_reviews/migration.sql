-- DATA IMPACT: none (additive: new enum, new table, new nullable column reviews.order_id)
-- Tables affected: order_reviews (new), reviews (ADD COLUMN order_id NULL)
-- Destructive operations: none
-- FK/cascade risk: none (RESTRICT on stores/orders, SET NULL on users/orders for reviews)
-- Idempotency: IF NOT EXISTS / guarded DO blocks

DO $$ BEGIN
  CREATE TYPE "order_review_quick_tag_enum" AS ENUM ('very_easy', 'normal', 'difficult');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "order_reviews" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "order_id" INTEGER NOT NULL,
  "customer_id" INTEGER,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "quick_tag" "order_review_quick_tag_enum",
  "source" VARCHAR(30) NOT NULL DEFAULT 'order_detail',
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "order_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "order_id" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "order_reviews_order_id_key" ON "order_reviews"("order_id");
CREATE INDEX IF NOT EXISTS "order_reviews_store_id_created_at_idx" ON "order_reviews"("store_id", "created_at");
CREATE INDEX IF NOT EXISTS "order_reviews_customer_id_idx" ON "order_reviews"("customer_id");
CREATE INDEX IF NOT EXISTS "reviews_order_id_idx" ON "reviews"("order_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_reviews_store_id_fkey') THEN
    ALTER TABLE "order_reviews" ADD CONSTRAINT "order_reviews_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_reviews_order_id_fkey') THEN
    ALTER TABLE "order_reviews" ADD CONSTRAINT "order_reviews_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_reviews_customer_id_fkey') THEN
    ALTER TABLE "order_reviews" ADD CONSTRAINT "order_reviews_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_order_id_fkey') THEN
    ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
