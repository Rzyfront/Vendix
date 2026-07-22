-- DATA IMPACT: additive enum values only. No data modification. No column changes.
-- Tables affected: notifications (via notification_type_enum column). Existing rows unaffected.
-- Idempotent: IF NOT EXISTS clause prevents duplicate-value errors on re-run.

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'table_payment_pending';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'table_payment_confirmed';