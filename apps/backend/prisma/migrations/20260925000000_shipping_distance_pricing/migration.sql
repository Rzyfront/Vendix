-- Cobro por distancia opcional por método de envío.
-- Solo columnas aditivas; cero mutación de datos; comportamiento idéntico
-- hasta que una tienda active `distance_pricing_enabled`.
-- Destructive operations: none.

ALTER TABLE "shipping_methods" ADD COLUMN IF NOT EXISTS "distance_pricing_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shipping_methods" ADD COLUMN IF NOT EXISTS "origin_latitude" DECIMAL(10, 8);
ALTER TABLE "shipping_methods" ADD COLUMN IF NOT EXISTS "origin_longitude" DECIMAL(11, 8);
ALTER TABLE "shipping_rates" ADD COLUMN IF NOT EXISTS "distance_tiers" JSONB;
