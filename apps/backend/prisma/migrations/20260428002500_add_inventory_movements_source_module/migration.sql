-- Add source_module to inventory_movements for traceability
-- DATA IMPACT: No data mutation. Adds nullable column.

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS source_module varchar(50);
