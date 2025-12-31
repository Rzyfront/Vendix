-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "alt_text" VARCHAR(255),
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;
