-- Calendario tributario → recordatorios en la bitácora (F1-F5).
--
-- DATA IMPACT:
--   Tables affected:
--     user_reminder_source_enum: +fiscal (recordatorios generados por el
--       calendario tributario).
--     user_reminders: 1 columna nueva `fiscal_obligation_id` (INT NULL), 1 FK
--       ON DELETE SET NULL hacia fiscal_obligations y 1 índice.
--   Expected row changes: 0. No INSERT/UPDATE/DELETE: las filas existentes
--     quedan con fiscal_obligation_id = NULL.
--   Destructive operations: none. No DROP, no TRUNCATE, no DML.
--   FK/cascade risk: ON DELETE SET NULL — borrar una obligación nunca borra un
--     recordatorio; el recordatorio solo pierde el vínculo.
--   Idempotency: ADD VALUE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
--     CREATE INDEX IF NOT EXISTS y FK guardada por pg_constraint. Re-ejecutarla
--     es un no-op.
--   Approval: odd/tasks/calendario-tributario-bitacora.md (Rafael, 2026-11-19).

-- 1. Nuevo origen de recordatorio (fuera de transacción, idempotente).
ALTER TYPE "user_reminder_source_enum" ADD VALUE IF NOT EXISTS 'fiscal';

-- 2. Vínculo opcional a la obligación fiscal (limpieza e idempotencia).
ALTER TABLE "user_reminders" ADD COLUMN IF NOT EXISTS "fiscal_obligation_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_reminders_fiscal_obligation_id_fkey'
  ) THEN
    ALTER TABLE "user_reminders"
      ADD CONSTRAINT "user_reminders_fiscal_obligation_id_fkey"
      FOREIGN KEY ("fiscal_obligation_id") REFERENCES "fiscal_obligations"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "user_reminders_fiscal_obligation_id_idx"
  ON "user_reminders"("fiscal_obligation_id");
