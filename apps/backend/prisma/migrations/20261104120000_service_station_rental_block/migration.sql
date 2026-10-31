-- service_stations: tarifa de alquiler por bloque (opcional).
--
-- Una estación con `rental_block_minutes` y `rental_block_price` cobra, al cerrar
-- la atención, una línea "Alquiler <estación>" con cantidad = bloques consumidos.
-- NULL en cualquiera de las dos = la estación no cobra alquiler (comportamiento actual).
--
-- DATA IMPACT:
--   Tables affected: service_stations (2 columnas nuevas, nullable, sin default).
--   Expected row changes: 0. No DML.
--   Destructive operations: ninguna.
--   Idempotency: ADD COLUMN IF NOT EXISTS; reejecutar no cambia nada.

ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "rental_block_minutes" INTEGER;
ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "rental_block_price" DECIMAL(12,2);
