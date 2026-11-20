-- P2 · Transferencias multi-producto: transporte, remisiones, recepción
-- parcial, destino externo y cierre con pérdida (D2–D9).
--
-- DATA IMPACT:
--   Tables affected:
--     stock_transfers: 21 columnas nuevas (nullable o con default), 1 índice
--       parcial de apoyo y 5 FKs nuevas. `to_location_id` pasa a NULLABLE para
--       admitir un destino externo (D8): las filas existentes conservan su
--       valor, no se reescribe ninguna.
--     stock_transfer_items: 3 columnas nuevas (batch_id NULL, quantity_dispatched
--       NULL, quantity_lost NOT NULL DEFAULT 0), 1 FK y 1 índice.
--     transfer_status_enum: +partially_received, +closed_with_loss.
--     New enums: transfer_movement_mode_enum, transfer_transport_method_enum,
--       transfer_support_document_type_enum.
--   Expected row changes: 0. No INSERT/UPDATE/DELETE. `to_location_id` only
--     drops its NOT NULL constraint (metadata-only in PostgreSQL).
--   Destructive operations: none. No DROP TABLE/COLUMN, no TRUNCATE, no DML.
--   FK/cascade risk: every new FK is ON DELETE SET NULL over optional metadata
--     (vehicle, driver, shipping method, remisión, usuario que cierra la
--     pérdida, lote): deleting the referenced row never deletes the transfer.
--   Idempotency: CREATE TYPE guarded by pg_type, ADD VALUE IF NOT EXISTS,
--     ADD COLUMN IF NOT EXISTS, DROP NOT NULL (idempotente) and FKs guarded by
--     pg_constraint. Re-running it is a no-op.
--   Approval: P2 protocolizado en odd/tasks/transferencias-multi.md
--     (decisiones D2–D9 de Rafael, 2026-11-19).

-- 1. Enums nuevos (guardados para re-ejecución).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_movement_mode_enum') THEN
    CREATE TYPE "transfer_movement_mode_enum" AS ENUM ('quick', 'mass_only', 'with_dispatch_notes');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_transport_method_enum') THEN
    CREATE TYPE "transfer_transport_method_enum" AS ENUM ('none', 'internal_carrier', 'internal_vehicle', 'internal_shipping_method', 'external_shipping_method');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_support_document_type_enum') THEN
    CREATE TYPE "transfer_support_document_type_enum" AS ENUM ('sales_order', 'invoice', 'purchase_order', 'return', 'other');
  END IF;
END $$;

-- 2. Estados nuevos. Postgres no permite USAR un valor de enum en la misma
--    transacción que lo agrega; esta migración no lo usa en ningún DML/DDL.
ALTER TYPE "transfer_status_enum" ADD VALUE IF NOT EXISTS 'partially_received';
ALTER TYPE "transfer_status_enum" ADD VALUE IF NOT EXISTS 'closed_with_loss';

-- 3. Destino externo (D8): sin bodega interna el destino no existe.
ALTER TABLE "stock_transfers" ALTER COLUMN "to_location_id" DROP NOT NULL;

-- 4. Cabecera: ejecución, transporte, remisiones, externo y cierre con pérdida.
ALTER TABLE "stock_transfers"
  ADD COLUMN IF NOT EXISTS "movement_mode" "transfer_movement_mode_enum",
  ADD COLUMN IF NOT EXISTS "transport_method" "transfer_transport_method_enum",
  ADD COLUMN IF NOT EXISTS "vehicle_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "driver_user_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "driver_name" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "shipping_method_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "carrier_name" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "tracking_number" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "shipping_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dispatch_note_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "receipt_note_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "is_external_destination" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "external_destination_name" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "external_destination_tax_id" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "external_destination_address" TEXT,
  ADD COLUMN IF NOT EXISTS "support_document_type" "transfer_support_document_type_enum",
  ADD COLUMN IF NOT EXISTS "support_document_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "exit_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "no_support_alert" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "loss_closed_at" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "loss_closed_by_user_id" INTEGER;

-- 5. Líneas: lote, conteo de salida y unidades perdidas.
ALTER TABLE "stock_transfer_items"
  ADD COLUMN IF NOT EXISTS "batch_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "quantity_dispatched" INTEGER,
  ADD COLUMN IF NOT EXISTS "quantity_lost" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "stock_transfers_dispatch_note_id_idx"
  ON "stock_transfers"("dispatch_note_id");
CREATE INDEX IF NOT EXISTS "stock_transfers_receipt_note_id_idx"
  ON "stock_transfers"("receipt_note_id");
CREATE INDEX IF NOT EXISTS "stock_transfers_vehicle_id_idx"
  ON "stock_transfers"("vehicle_id");
CREATE INDEX IF NOT EXISTS "stock_transfers_is_external_destination_idx"
  ON "stock_transfers"("is_external_destination");
CREATE INDEX IF NOT EXISTS "stock_transfer_items_batch_id_idx"
  ON "stock_transfer_items"("batch_id");

-- 6. FKs nuevas (guardadas por nombre para re-ejecución).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_vehicle_id_fkey') THEN
    ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_driver_user_id_fkey') THEN
    ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_shipping_method_id_fkey') THEN
    ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_shipping_method_id_fkey" FOREIGN KEY ("shipping_method_id") REFERENCES "shipping_methods"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_dispatch_note_id_fkey') THEN
    ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_dispatch_note_id_fkey" FOREIGN KEY ("dispatch_note_id") REFERENCES "dispatch_notes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_receipt_note_id_fkey') THEN
    ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_receipt_note_id_fkey" FOREIGN KEY ("receipt_note_id") REFERENCES "dispatch_notes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_loss_closed_by_user_id_fkey') THEN
    ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_loss_closed_by_user_id_fkey" FOREIGN KEY ("loss_closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfer_items_batch_id_fkey') THEN
    ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
