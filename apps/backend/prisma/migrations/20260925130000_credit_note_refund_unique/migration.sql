-- DATA IMPACT: none
-- Release-853 (paso 8): unicidad "un refund, una NC viva". Índice parcial
-- sobre invoices(refund_id): como máximo una nota crédito en estado
-- draft/validated/sent/accepted por refund. Schema-only: sin UPDATE, sin
-- DELETE, sin backfill (NULL = nota manual, el 100 % del histórico, y las
-- rechazadas/anuladas no cuentan). Patrón gemelo del índice parcial
-- `invoices_contract_id_active_uq` (20260906040000_invoice_contract_id).
-- La guarda pre-vuelo de `resolveRefundLink` no cierra la carrera (doble
-- clic / dos operadores); el índice sí, y el P2002 se traduce al error de
-- "refund ya vinculado" en `throwIfDuplicateRefundLink`.
-- NOTA: creada a mano + `migrate deploy` (no `migrate dev`) porque el shadow
-- DB del repo está roto pre-existente (P3006) y no hay cambio de schema que
-- difuminar (Prisma no declara índices parciales) — mismo precedente que
-- `20260925014502_refund_line_coverage`.

-- Pre-chequeo: aborta si ya existen duplicados vivos (dos NC activas sobre
-- el mismo refund). Sin duplicados no hace nada; con duplicados hay que
-- anular el sobrante antes de aplicar.
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT "refund_id"
    FROM "invoices"
    WHERE "invoice_type" = 'credit_note'
      AND "refund_id" IS NOT NULL
      AND "status" IN ('draft', 'validated', 'sent', 'accepted')
    GROUP BY "refund_id"
    HAVING COUNT(*) > 1
  ) dups;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'credit_note_refund_unique: % refund(s) con más de una NC viva; anula el duplicado antes de aplicar', dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_refund_id_active_credit_note_key"
  ON "invoices"("refund_id")
  WHERE "invoice_type" = 'credit_note'
    AND "refund_id" IS NOT NULL
    AND "status" IN ('draft', 'validated', 'sent', 'accepted');
