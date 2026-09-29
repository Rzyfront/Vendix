-- DATA IMPACT:
-- Tables affected: invoices
-- Expected row changes: none (ADD COLUMN nullable, no backfill/UPDATE)
-- Destructive operations: none
-- FK/cascade risk: none (no foreign key introduced)
-- Idempotency: guarded by IF NOT EXISTS
-- Approval: pre-approved by user for Task D (persona natural con NIT) — additive-only, no backfill
--
-- Adds `invoices.customer_person_type`, reusing the EXISTING `persona_type_enum`
-- (NATURAL / JURIDICA), already defined on `users.person_type` since migration
-- 20260814232558. No `CREATE TYPE` needed.
--
-- Purpose: freeze the acquirer's person type as part of the `customer_*`
-- snapshot on `invoices`, so `resolveAcquirerIdentity` can fall back to it when
-- there is no linked customer (manual invoices) and no declared value, instead
-- of mis-deriving JURIDICA for a natural person who has a NIT.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "customer_person_type" "persona_type_enum";
