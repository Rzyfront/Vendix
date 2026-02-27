-- AlterTable: Change default of track_inventory from false to true
ALTER TABLE "products" ALTER COLUMN "track_inventory" SET DEFAULT true;

-- DataMigration: Set track_inventory = true for existing products that have stock
UPDATE "products" SET "track_inventory" = true WHERE "stock_quantity" > 0;
