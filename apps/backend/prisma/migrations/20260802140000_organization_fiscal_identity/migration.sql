-- DATA IMPACT:
-- Tables affected: organizations
-- Expected row changes: 0 — additive columns only; every new column is either
--   NULLable or has a DEFAULT, so existing rows are untouched.
-- Destructive operations: none (no DROP, no TRUNCATE, no unqualified UPDATE/DELETE)
-- FK/cascade risk: none — no FK is created, altered or dropped.
-- Idempotency: every statement is guarded with IF NOT EXISTS, so a re-run is a no-op.
-- Approval: additive-only, no data mutation — covered by the standing rule that
--   additive migrations do not require a prod snapshot.
--
-- WHY: Vendix bills its own subscriptions electronically, which makes the client
-- organization the *adquiriente* of a DIAN invoice. `cac:AccountingCustomerParty`
-- needs more than the name and NIT that `organizations` holds today:
--   - CompanyID/@schemeID  -> verification_digit (DV of the NIT)
--   - CompanyID/@schemeName -> document_type (DIAN code: '31' NIT, '13' CC, ...)
--   - AdditionalAccountID  -> person_type ('1' jurídica / '2' natural)
--   - TaxLevelCode         -> fiscal_responsibilities (O-13, O-15, O-23, R-99-PN...)
--   - PartyTaxScheme       -> tax_regime ('48' responsable de IVA / '49' no responsable)
-- Column names and types mirror `suppliers`, which already models the same
-- fiscal party shape, so the two stay readable side by side.
--
-- The postal address is NOT duplicated here: `addresses` already has
-- address_line1 / city / state_province / municipality_code / country_code /
-- postal_code and already links to `organizations` via organization_id. The
-- fiscal address is the row with type = 'billing'.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "document_type" VARCHAR(10);

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "verification_digit" VARCHAR(1);

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "person_type" VARCHAR(20);

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "tax_regime" VARCHAR(50);

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "fiscal_responsibilities" TEXT[] NOT NULL DEFAULT '{}';
