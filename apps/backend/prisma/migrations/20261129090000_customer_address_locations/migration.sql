-- Clientes con múltiples ubicaciones (establecimientos).
-- DATA IMPACT:
-- Tables affected: addresses, quotations, contracts (schema only)
-- Expected row changes: none (new nullable columns, no backfill)
-- Destructive operations: none
-- FK/cascade risk: new FKs to addresses use ON DELETE SET NULL (snapshot keeps history)
-- Idempotency: IF NOT EXISTS / pg_constraint guards

ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "label" VARCHAR(120);

ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "customer_address_id" INTEGER;
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "customer_address_snapshot" JSONB;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "customer_address_id" INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "customer_address_snapshot" JSONB;

CREATE INDEX IF NOT EXISTS "quotations_customer_address_id_idx" ON "quotations"("customer_address_id");
CREATE INDEX IF NOT EXISTS "contracts_customer_address_id_idx" ON "contracts"("customer_address_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotations_customer_address_id_fkey') THEN
    ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_address_id_fkey"
      FOREIGN KEY ("customer_address_id") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_customer_address_id_fkey') THEN
    ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_address_id_fkey"
      FOREIGN KEY ("customer_address_id") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
