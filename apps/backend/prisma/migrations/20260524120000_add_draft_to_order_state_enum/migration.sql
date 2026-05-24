-- DATA IMPACT: Non-destructive. Adds `draft` value to order_state_enum.
-- Affected rows: 0 (existing orders unaffected).
-- Reversible only via manual enum recreation (Postgres limitation).
ALTER TYPE order_state_enum ADD VALUE IF NOT EXISTS 'draft' BEFORE 'created';
