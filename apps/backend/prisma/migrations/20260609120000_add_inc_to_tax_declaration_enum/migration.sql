-- DATA IMPACT:
-- Tables affected: none (enum value addition only)
-- Expected row changes: none
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: ADD VALUE IF NOT EXISTS
-- Approval: documented in chat (Rafael, 2026-06-09 — fiscal tax typing plan)
--
-- Adds 'inc' (Impuesto Nacional al Consumo) to the fiscal declaration type enum.
-- Kept in its own migration so the new value is not consumed in the same
-- transaction that adds it (Postgres enum ADD VALUE restriction).

ALTER TYPE "tax_declaration_type_enum" ADD VALUE IF NOT EXISTS 'inc';
