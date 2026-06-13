-- DATA IMPACT:
-- Tables affected: none (enum type extension only)
-- Expected row changes: 0
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: ADD VALUE IF NOT EXISTS
-- Approval: documented in fiscal-tax-typing plan (Step 9)

-- Adds the INC (Impuesto Nacional al Consumo) obligation type so the fiscal
-- calendar can surface an INC return alongside vat_return. Kept in its own
-- migration because Postgres forbids using a freshly added enum value within
-- the same transaction that adds it.
ALTER TYPE "fiscal_obligation_type_enum" ADD VALUE IF NOT EXISTS 'inc_return';
