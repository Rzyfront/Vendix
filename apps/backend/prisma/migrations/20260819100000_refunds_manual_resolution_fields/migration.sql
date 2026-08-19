-- DATA IMPACT:
-- Tables affected: refunds
-- Expected row changes: 0 (additive nullable columns only; no row mutation)
-- Destructive operations: ninguna
-- FK/cascade risk: ninguno (FK usa ON DELETE SET NULL; null-out, no cascade)
-- Idempotency: ADD COLUMN IF NOT EXISTS + ADD CONSTRAINT IF NOT EXISTS
-- Reversibility: ALTER TABLE refunds DROP COLUMN IF EXISTS resolution_notes;
--                ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_resolved_by_user_id_fkey;
--                ALTER TABLE refunds DROP COLUMN IF EXISTS resolved_by_user_id;
-- Approval: plan CP-refund-gateway-dispatch-fix, ADR-3, Phase A.2 (W1-B).
-- Scope: A.2 — auditoría de cierre manual de refunds (resolved_by + notes).
-- Justificación: los refunds cerrados por el flujo automático (gateway sync)
--   no pasan por aquí. La auditoría es exclusiva del camino manual
--   PATCH /store/orders/:orderId/flow/refunds/:refundId/resolve (B.2).
--   Ambos campos son NULL hasta que un operador resuelve el refund, de modo
--   que esta migración es puramente aditiva y no requiere backfill.

ALTER TABLE "refunds"
  ADD COLUMN IF NOT EXISTS "resolved_by_user_id" INTEGER;

ALTER TABLE "refunds"
  ADD COLUMN IF NOT EXISTS "resolution_notes" TEXT;

ALTER TABLE "refunds"
  ADD CONSTRAINT IF NOT EXISTS "refunds_resolved_by_user_id_fkey"
  FOREIGN KEY ("resolved_by_user_id")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE NO ACTION;