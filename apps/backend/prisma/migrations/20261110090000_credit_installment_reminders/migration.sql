-- DATA IMPACT:
-- Tables affected: credit_installment_reminder_logs (new, empty); notification_type_enum (+1 value)
-- Expected row changes: none (no backfill, no UPDATE/DELETE)
-- Destructive operations: none
-- FK/cascade risk: logs cascade only from their own installment (log rows, no business data)
-- Idempotency: IF NOT EXISTS / pg_constraint guards

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'credit_installment_reminder';

CREATE TABLE IF NOT EXISTS "credit_installment_reminder_logs" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "installment_id" INTEGER NOT NULL,
    "rule_key" VARCHAR(30) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "sent_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_installment_reminder_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "credit_installment_reminder_logs_store_id_idx"
  ON "credit_installment_reminder_logs"("store_id");

CREATE UNIQUE INDEX IF NOT EXISTS "credit_installment_reminder_logs_installment_id_rule_key_channel_key"
  ON "credit_installment_reminder_logs"("installment_id", "rule_key", "channel");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_installment_reminder_logs_store_id_fkey'
  ) THEN
    ALTER TABLE "credit_installment_reminder_logs"
      ADD CONSTRAINT "credit_installment_reminder_logs_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_installment_reminder_logs_installment_id_fkey'
  ) THEN
    ALTER TABLE "credit_installment_reminder_logs"
      ADD CONSTRAINT "credit_installment_reminder_logs_installment_id_fkey"
      FOREIGN KEY ("installment_id") REFERENCES "order_installments"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
