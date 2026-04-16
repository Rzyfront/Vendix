-- AlterEnum: Add 'refunded' to expenses_state_enum
ALTER TYPE "expenses_state_enum" ADD VALUE IF NOT EXISTS 'refunded';

-- AlterTable: Add refund fields to expenses
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "refunded_at" TIMESTAMP(6);
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "refunded_by_user_id" INTEGER;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "refund_reason" VARCHAR(500);

-- AddForeignKey: refunded_by_user_id -> users
DO $$ BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM information_schema.table_constraints
   WHERE constraint_name = 'expenses_refunded_by_user_id_fkey'
   AND table_name = 'expenses'
 ) THEN
   ALTER TABLE "expenses" ADD CONSTRAINT "expenses_refunded_by_user_id_fkey" FOREIGN KEY ("refunded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
 END IF;
END $$;
