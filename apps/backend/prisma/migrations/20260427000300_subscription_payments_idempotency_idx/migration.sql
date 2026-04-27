-- Migration: 20260427000300_subscription_payments_idempotency_idx
-- DATA IMPACT: schema-only. Creates a B-tree expression index on
-- subscription_payments(metadata->>'idempotency_key'). No rows mutated.
-- Idempotent (IF NOT EXISTS); safe to re-run.
--
-- Why: webhooks (POST /platform/webhooks/wompi) need to match Wompi
-- transaction.reference back to the originating subscription_payments
-- row. The reference uses the same idempotency_key
-- ("sub_inv_{invoiceId}_att_{n}") that we stash in metadata at charge
-- time. Currently we resolve via "latest payment for invoice", which is
-- correct for the common case but a JSON-path lookup is more precise
-- when multiple attempts coexist. This index keeps that future lookup
-- fast without adding a new column.

CREATE INDEX IF NOT EXISTS "subscription_payments_idempotency_key_idx"
  ON "subscription_payments" ((metadata ->> 'idempotency_key'));
