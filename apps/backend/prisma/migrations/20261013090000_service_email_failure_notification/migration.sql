-- DATA IMPACT:
-- Tables affected: notification_type_enum
-- Expected row changes: adds one enum label; no existing rows are modified
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: ADD VALUE IF NOT EXISTS
-- Approval: additive notification type

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'service_session_email_failed';