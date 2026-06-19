-- DATA IMPACT: aditiva. Agrega 1 columna booleana con default false a order_items.
-- Sin mutacion de filas. Sin operaciones destructivas. Backfill: existing rows
-- quedan con skip_kds=false (default), preservando el comportamiento actual
-- (los items no-prepared se filtran por product_type en kitchen-fire.service.ts).
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "skip_kds" BOOLEAN NOT NULL DEFAULT false;
