-- DATA IMPACT:
-- Tables affected: purchase_orders
-- Expected row changes: 0 (additive index only, no row mutation)
-- Destructive operations: ninguna
-- FK/cascade risk: ninguno
-- Idempotency: CREATE INDEX CONCURRENTLY IF NOT EXISTS — re-ejecutable sin error
-- Reversibility: DROP INDEX CONCURRENTLY IF EXISTS po_supplier_date_idx; DROP INDEX CONCURRENTLY IF EXISTS po_status_idx;
-- Approval: plan CP-ID-VNDX-2026-08-18-PO-PROD, ADR-005, F1.S3.
-- Scope: F1.S3 — performance de sort/filtros en PO list y supplier profile.
-- Justificación: PO list (sort_by=order_date, supplier_id) y supplier profile
--   (filter por supplier_id) hacen seq scan hoy. Sin índices dedicados.

CREATE INDEX CONCURRENTLY IF NOT EXISTS po_supplier_date_idx
  ON purchase_orders (supplier_id, order_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS po_status_idx
  ON purchase_orders (status);
