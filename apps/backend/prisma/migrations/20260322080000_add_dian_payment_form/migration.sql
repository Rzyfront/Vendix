-- Add payment_form to orders (DIAN: 1=contado, 2=crédito)
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_form" VARCHAR(2);

-- Add dian_code to system_payment_methods
ALTER TABLE "system_payment_methods" ADD COLUMN IF NOT EXISTS "dian_code" VARCHAR(5);

-- Populate DIAN codes for existing payment methods
UPDATE "system_payment_methods" SET "dian_code" = '10' WHERE "name" = 'cash' AND "dian_code" IS NULL;
UPDATE "system_payment_methods" SET "dian_code" = '48' WHERE "type" = 'card' AND "dian_code" IS NULL;
UPDATE "system_payment_methods" SET "dian_code" = '47' WHERE "type" = 'bank_transfer' AND "dian_code" IS NULL;
UPDATE "system_payment_methods" SET "dian_code" = '1' WHERE "dian_code" IS NULL;
