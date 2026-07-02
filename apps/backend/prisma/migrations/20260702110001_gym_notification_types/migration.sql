-- DATA IMPACT:
-- Tables affected: none.
-- Enum changes: notification_type_enum += 'gym_membership_expiring', 'gym_membership_expired'
--   (idempotent ADD VALUE; values are NOT used in this migration's DDL).
-- Expected row changes: none.
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: guarded with ADD VALUE IF NOT EXISTS — safe to re-run.
-- Approval: gym industry epic (Ola 1), membership-expiry notifications.

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'gym_membership_expiring';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'gym_membership_expired';
