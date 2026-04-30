-- DATA IMPACT:
-- Tablas afectadas: subscription_payment_methods (solo ALTER TABLE — agrega columnas anulables)
-- Filas afectadas: 0 (cambio aditivo, no toca datos)
-- Reversible: SÍ (DROP COLUMN si fuera necesario, pero NO destructivo en sí mismo)

ALTER TABLE "subscription_payment_methods"
  ADD COLUMN IF NOT EXISTS "provider_payment_source_id" varchar(64),
  ADD COLUMN IF NOT EXISTS "acceptance_token_used" text,
  ADD COLUMN IF NOT EXISTS "cof_registered_at" timestamp(6);

CREATE INDEX IF NOT EXISTS "idx_spm_store_psid"
  ON "subscription_payment_methods" ("store_id", "provider_payment_source_id")
  WHERE "provider_payment_source_id" IS NOT NULL;
