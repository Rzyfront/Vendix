-- DATA IMPACT: aditiva. Agrega 2 columnas nullable + 1 index + 1 unique a kitchen_tickets. Sin mutación de filas. Sin operaciones destructivas.
ALTER TABLE "kitchen_tickets" ADD COLUMN IF NOT EXISTS "daily_number" INTEGER;
ALTER TABLE "kitchen_tickets" ADD COLUMN IF NOT EXISTS "business_date" DATE;
CREATE INDEX IF NOT EXISTS "kitchen_tickets_store_id_business_date_idx" ON "kitchen_tickets"("store_id", "business_date");
CREATE UNIQUE INDEX IF NOT EXISTS "kitchen_tickets_store_id_business_date_daily_number_key" ON "kitchen_tickets"("store_id", "business_date", "daily_number");
