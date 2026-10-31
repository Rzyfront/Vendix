-- service_stations: impuesto configurable del alquiler por bloque.
--
-- Mismo mecanismo que `shipping_rates.tax_category_id` + `tax_is_inclusive`:
-- la estación puede llevar una categoría de impuesto (IVA/INC, una sola tasa
-- > 0) y su modo (incluido en el precio del bloque o agregado encima).
-- NULL = sin impuesto = comportamiento actual de las ventas existentes.
--
-- DATA IMPACT:
--   Tables affected: service_stations (2 columnas nuevas, 1 índice, 1 FK).
--   Expected row changes: 0. No DML. Filas existentes: categoría NULL (sin
--   impuesto) y modo incluido (default true, metadata-only en PG >= 11).
--   Destructive operations: ninguna. Sin DROP, UPDATE, DELETE ni CASCADE.
--   FK/cascade risk: FK a tax_categories ON DELETE RESTRICT (una categoría en
--   uso no se borra en silencio).
--   Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS y FK
--   protegida con pg_constraint; reejecutar no cambia nada.
--   Approval: impuesto configurable del alquiler, decisión de Rafael (2026-10-30).

ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "rental_tax_category_id" INTEGER;
ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "rental_tax_is_inclusive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "service_stations_rental_tax_category_id_idx" ON "service_stations"("rental_tax_category_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_stations_rental_tax_category_id_fkey'
  ) THEN
    ALTER TABLE "service_stations"
      ADD CONSTRAINT "service_stations_rental_tax_category_id_fkey"
      FOREIGN KEY ("rental_tax_category_id") REFERENCES "tax_categories"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
