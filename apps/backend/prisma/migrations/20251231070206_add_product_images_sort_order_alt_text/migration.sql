-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "alt_text" VARCHAR(255),
ADD COLUMN     "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sort_order" INTEGER DEFAULT 0;
