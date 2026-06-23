-- =============================================================================
-- Migration: qui431_serial_tracking (QUI-431 — Registro de seriales en productos)
-- Created: 2026-06-23
-- Idempotent: yes (guarded enum, IF NOT EXISTS on table/columns/indexes/FK)
-- =============================================================================
-- DATA IMPACT:
-- Tables affected: sales_document_serials (NEW), order_items, invoice_items,
--                  refund_items (1 nullable TEXT column added to each)
-- Expected row changes: 0 (purely additive; no UPDATE/DELETE of existing rows)
-- New objects: 1 enum (sales_document_item_type_enum), 1 table
--              (sales_document_serials) + its FK and 3 indexes,
--              3 nullable TEXT columns (serial_numbers_snapshot)
-- Destructive operations: none (no DROP / TRUNCATE / CASCADE,
--                         no unscoped UPDATE/DELETE)
-- FK/cascade risk: none — only inbound FK is sales_document_serials.serial ->
--                  inventory_serial_numbers(id) ON DELETE RESTRICT (protects
--                  the pool; a serial linked to a document cannot be deleted).
-- Existing snapshot preserved: dispatch_note_items.lot_serial is NOT touched.
-- Idempotency: guarded by DO/EXCEPTION (enum) and IF NOT EXISTS (table, columns,
--              indexes) + duplicate_object guard on the FK constraint.
-- Approval: additive-only, no data mutation; documented in plan QUI-431.
-- =============================================================================

-- ─── ENUM ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE sales_document_item_type_enum AS ENUM (
    'order_item', 'sales_order_item', 'invoice_item', 'refund_item', 'dispatch_note_item'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── JUNCTION TABLE: sales_document_serials ────────────────────────────────────

CREATE TABLE IF NOT EXISTS "sales_document_serials" (
  "id"                 SERIAL PRIMARY KEY,
  "serial_number_id"   INTEGER NOT NULL,
  "document_item_type" "sales_document_item_type_enum" NOT NULL,
  "document_item_id"   INTEGER NOT NULL,
  "quantity"           INTEGER NOT NULL DEFAULT 1,
  "created_at"         TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

-- FK: serial -> inventory_serial_numbers(id). ON DELETE RESTRICT protects the
-- pool from deleting a serial that is already committed to a document line.
DO $$ BEGIN
  ALTER TABLE "sales_document_serials"
    ADD CONSTRAINT "sales_document_serials_serial_number_id_fkey"
    FOREIGN KEY ("serial_number_id") REFERENCES "inventory_serial_numbers"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Anti double-sale guard: a serial can appear at most once per document type.
CREATE UNIQUE INDEX IF NOT EXISTS "sales_document_serials_document_item_type_serial_number_id_key"
  ON "sales_document_serials" ("document_item_type", "serial_number_id");

CREATE INDEX IF NOT EXISTS "sales_document_serials_document_item_type_document_item_id_idx"
  ON "sales_document_serials" ("document_item_type", "document_item_id");

CREATE INDEX IF NOT EXISTS "sales_document_serials_serial_number_id_idx"
  ON "sales_document_serials" ("serial_number_id");

-- ─── IMMUTABLE SNAPSHOT COLUMNS (CSV of serial numbers per document line) ───────

ALTER TABLE "order_items"   ADD COLUMN IF NOT EXISTS "serial_numbers_snapshot" TEXT;
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "serial_numbers_snapshot" TEXT;
ALTER TABLE "refund_items"  ADD COLUMN IF NOT EXISTS "serial_numbers_snapshot" TEXT;
