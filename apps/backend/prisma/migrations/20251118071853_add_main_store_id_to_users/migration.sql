-- AlterTable
ALTER TABLE "users" ADD COLUMN     "main_store_id" INTEGER;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_main_store_id_fkey" FOREIGN KEY ("main_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
