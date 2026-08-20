-- DATA IMPACT:
-- Tables affected: audit_logs
-- Expected row changes: 0 (additive nullable column only; no row mutation)
-- Destructive operations: ninguna
-- FK/cascade risk: ninguno (columna nullable sin FK)
-- Idempotency: ADD COLUMN IF NOT EXISTS (Postgres ≥ 9.6)
-- Reversibility: ALTER TABLE audit_logs DROP COLUMN IF EXISTS metadata;
-- Approval: plan CP-POS-CREAR-EDITAR-COBRAR-001, Round 2 BLOCKER B1.
-- Scope: F.2 · persistir metadata de eventos de auditoría que hoy se
--   perdía silenciosamente (request_id, transaction_id, error_code,
--   before_totals/after_totals, etc.).
-- Justificación: el `auditService.log` ya aceptaba `metadata`, pero la
--   columna no existía en el esquema y Prisma la descartaba en silencio.
--   Esta migración es puramente aditiva y no requiere backfill — las
--   filas existentes quedan con `metadata = NULL`, que es semánticamente
--   correcto (no había metadata para esos eventos).

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;