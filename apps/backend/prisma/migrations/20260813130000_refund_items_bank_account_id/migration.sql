-- Refund overhaul (parallel run): bank_account_id for refund_method='bank_transfer'.
--
-- DATA IMPACT:
-- Tables affected: refund_items (nueva columna nullable + FK)
-- Expected row changes: NINGUNO. La columna nueva es nullable con DEFAULT NULL,
--   que es la semántica correcta para refunds históricos (no son bank_transfer).
--   No se reescribe ni una fila a mano.
-- Destructive operations: none. No DROP, no TRUNCATE, no DELETE, no ALTER de
--   enums existentes. La FK usa ON DELETE SET NULL para preservar el audit
--   trail cuando se elimina una bank_account (la refund queda con
--   bank_account_id = NULL pero el resto de la fila intacta).
-- Idempotency: IF NOT EXISTS / DO $$ sobre pg_constraint, idempotente.
-- Approval: firmado en plan docs/plans/refund-modal-overhaul.md (8 steps, 1 PR).
-- Skill: vendix-prisma-migrations (regla 7 anti-destructiva, regla 5 idempotencia).

ALTER TABLE "refund_items"
  ADD COLUMN IF NOT EXISTS "bank_account_id" INTEGER;

-- Foreign key con ON DELETE SET NULL: al borrar una bank_account, las refund_items
-- históricas no se eliminan ni bloquean; sólo pierden el puntero al banco.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refund_items_bank_account_id_fkey'
  ) THEN
    ALTER TABLE "refund_items"
      ADD CONSTRAINT "refund_items_bank_account_id_fkey"
      FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- Index para joins frecuentes (refund_items.bank_account_id → bank_accounts.id
-- en财务报表 y queries de auditoría por cuenta bancaria).
CREATE INDEX IF NOT EXISTS "refund_items_bank_account_id_idx"
  ON "refund_items" ("bank_account_id");
