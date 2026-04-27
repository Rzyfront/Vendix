-- Add 'pending_payment' to store_subscription_state_enum.
--
-- Why:
--   The previous flow created a paid subscription with state='active' BEFORE
--   the Wompi payment was confirmed by the webhook, so a customer who closed
--   the widget without paying ended up with full access to a paid plan.
--   The new flow creates the subscription in 'pending_payment' until the
--   webhook (or POS confirm) transitions it to 'active' via the state engine.
--
-- DATA IMPACT:
--   Pure enum addition (additive). No existing rows are modified by this
--   migration. Idempotent via `ADD VALUE IF NOT EXISTS` (Postgres 12+) and
--   safe to re-run.

ALTER TYPE "store_subscription_state_enum" ADD VALUE IF NOT EXISTS 'pending_payment';
