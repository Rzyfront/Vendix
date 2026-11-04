-- Service providers can be store users (non-customers), not only payroll employees.
--
-- DATA IMPACT:
-- Tables affected: service_providers (schema only)
-- Expected row changes: none (no UPDATE/DELETE; existing providers keep employee_id)
-- Destructive operations: none (DROP NOT NULL only relaxes a constraint)
-- FK/cascade risk: new FK user_id -> users ON DELETE RESTRICT; no cascade
-- Idempotency: guarded by IF NOT EXISTS / pg_constraint checks

ALTER TABLE "service_providers" ADD COLUMN IF NOT EXISTS "user_id" INTEGER;

ALTER TABLE "service_providers" ALTER COLUMN "employee_id" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "service_providers_store_id_user_id_key"
  ON "service_providers"("store_id", "user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_providers_user_id_fkey'
  ) THEN
    ALTER TABLE "service_providers"
      ADD CONSTRAINT "service_providers_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
