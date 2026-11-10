-- QUI-994: free-text note per sold add-on (same limit as the order line note, 500).
-- DATA IMPACT: none (additive nullable column). No rows are read, rewritten or deleted;
-- existing order_item_options rows keep note = NULL.
ALTER TABLE "order_item_options" ADD COLUMN IF NOT EXISTS "note" VARCHAR(500);
