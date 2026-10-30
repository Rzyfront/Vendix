-- DATA IMPACT:
-- Tables affected: data_collection_templates gains checkin_show_budget,
--   checkin_show_products, checkin_show_notes (NOT NULL DEFAULT true).
-- Expected row changes: none. Existing templates keep all checkin blocks
--   visible (nothing hidden).
-- Destructive operations: none.
-- FK/cascade risk: none (no constraint added).
-- Idempotency: ADD COLUMN IF NOT EXISTS.
-- Approval: estaciones de servicio, bloques configurables de la recepción.

-- Bloques fijos de la recepción (Asignar) que cada plantilla muestra.
-- Servicio y técnico van siempre; presupuesto, productos y notas los puede
-- quitar el administrador por plantilla desde Diseñar plantilla.
ALTER TABLE "data_collection_templates"
  ADD COLUMN IF NOT EXISTS "checkin_show_budget" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "checkin_show_products" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "checkin_show_notes" BOOLEAN NOT NULL DEFAULT true;
