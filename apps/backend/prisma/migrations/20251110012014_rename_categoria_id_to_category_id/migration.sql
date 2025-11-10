-- DropForeignKey
ALTER TABLE "public"."products" DROP CONSTRAINT "products_categoria_id_fkey";

-- AlterTable
ALTER TABLE "public"."products" RENAME COLUMN "categoria_id" TO "category_id";

-- AddForeignKey
ALTER TABLE "public"."products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
