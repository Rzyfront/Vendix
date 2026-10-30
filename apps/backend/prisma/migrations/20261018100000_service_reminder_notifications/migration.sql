-- DATA IMPACT:
-- Tables affected: service_reminder_logs; enum notification_type_enum.
-- Expected row changes: no existing rows changed; new notification type and nullable claim timestamp.
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: enum and column additions are guarded.
-- Approval: implementation continuation requested by the user.

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'service_reminder_due';
ALTER TABLE "service_reminder_logs"
  ADD COLUMN IF NOT EXISTS "notification_sent_at" TIMESTAMPTZ(6);
