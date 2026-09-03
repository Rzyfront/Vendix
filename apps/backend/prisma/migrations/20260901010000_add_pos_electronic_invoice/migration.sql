-- DATA IMPACT:
-- Tables affected: pg_type (print_format_type_enum)
-- Expected row changes: 0 rows migrated; pg_enum values 15 -> 16.
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by ADD VALUE IF NOT EXISTS (safe on re-run).
-- Approval: documented in CP-POS-ELECTRONIC-INVOICE-AND-FLAGS-MIGRATION.
--
-- Agrega el nuevo tipo de formato para factura electrónica POS térmica (80mm).
ALTER TYPE "print_format_type_enum" ADD VALUE IF NOT EXISTS 'pos_electronic_invoice';
