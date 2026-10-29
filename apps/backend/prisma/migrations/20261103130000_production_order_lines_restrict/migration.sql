-- production_order_lines: FK de la orden pasa de ON DELETE CASCADE a RESTRICT.
--
-- Motivo (CLAUDE.md:48): `production_orders` es una tabla padre con datos de
-- negocio. Con CASCADE, borrar una orden se llevaba en silencio sus líneas
-- (planificado vs consumido, costo congelado y trazabilidad por componente).
-- Con RESTRICT el borrado falla y obliga a decidir explícitamente.
--
-- DATA IMPACT:
--   Tables affected: production_order_lines (constraint only).
--   Expected row changes: 0. No DML.
--   Destructive operations: ninguna (el DROP CONSTRAINT es de la FK, no de datos).
--   Idempotency: DROP ... IF EXISTS + ADD; reejecutar deja el mismo constraint.
--
-- Nota: la migración 20261103120000_manufacturing_module ya está aplicada en
-- varias bases y es inmutable (checksum), por eso el cambio va aquí y no allí.

ALTER TABLE "production_order_lines"
  DROP CONSTRAINT IF EXISTS "production_order_lines_order_id_fkey";

ALTER TABLE "production_order_lines"
  ADD CONSTRAINT "production_order_lines_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "production_orders"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
