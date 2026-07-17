-- DATA IMPACT: none. Additive enum value. No backfill, no row lock.
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'order_awaiting_carrier';
