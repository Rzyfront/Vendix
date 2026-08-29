-- =====================================================================
-- Migration: add_payments_bank_account_fk (CP-POLLO-ARABE-727 A.3 / ADR-3)
-- Purpose: Añadir `payments.bank_account_id` → `bank_accounts(id)` con FK
--          RESTRICT (no SET NULL) e índice parcial.
-- =====================================================================
--
-- DATA IMPACT:
--   Tables affected: payments (schema-only)
--   Rows mutated:    NONE (additive + nullable)
--   Destructive operations: none
--   FK/cascade risk: bank_account_id -> bank_accounts(id) ON DELETE RESTRICT
--                    (NO SET NULL — ADR-3 / Data Integrity Plan: la FK hermana
--                     payments.store_payment_method_id ya usa Restrict para no
--                     perder trazabilidad contable; bank_accounts tiene
--                     status active|inactive|closed para retiro lógico)
--   Idempotency: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS +
--                ADD CONSTRAINT guardado con EXCEPTION WHEN duplicate_object
--   Approval: CP-POLLO-ARABE-727 A.3 / ADR-3
-- =====================================================================

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "bank_account_id" integer;

-- Índice parcial: solo indexa pagos con cuenta asignada (la mayoría de filas
-- legacy quedan con NULL y no deben pesar en el índice).
CREATE INDEX IF NOT EXISTS "payments_bank_account_idx"
  ON "payments"("bank_account_id") WHERE "bank_account_id" IS NOT NULL;

DO $$
BEGIN
  BEGIN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_bank_account_id_fkey"
      FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END
$$;
