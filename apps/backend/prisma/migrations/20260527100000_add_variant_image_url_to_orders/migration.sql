-- DATA IMPACT:
-- Tables affected: order_items, sales_order_items
-- Expected row changes: none (schema-only addition; existing rows remain NULL)
-- Destructive operations: none
-- FK/cascade risk: none (column has no FK and is nullable)
-- Idempotency: ADD COLUMN IF NOT EXISTS guards re-execution
-- Approval: documented in chat (Parte 4 - variant image snapshot)
--
-- Adds nullable variant_image_url (VARCHAR 500) to order_items and sales_order_items
-- to persist the S3 key snapshot of the purchased variant image. No backfill is
-- performed: legacy rows stay NULL, and the frontend falls back to the product
-- image when this snapshot is missing.

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "variant_image_url" VARCHAR(500);
ALTER TABLE "sales_order_items" ADD COLUMN IF NOT EXISTS "variant_image_url" VARCHAR(500);
