-- DATA IMPACT:
-- Tables affected: none (enum type only: notification_type_enum)
-- Expected row changes: none (adds 3 enum labels, no rows read/written)
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by ADD VALUE IF NOT EXISTS
-- Approval: dine-in QR plan (Ola 0, Step 1)
--
-- Dine-in QR: add table-notification enum values (additive).
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'table_call_waiter';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'table_request_bill';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'table_request_split';
