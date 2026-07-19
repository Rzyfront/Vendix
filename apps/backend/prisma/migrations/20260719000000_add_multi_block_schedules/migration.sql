-- AlterTable: provider_schedules
-- Remove single-block-per-day constraint, add block_order for multi-block support
-- Idempotent: safe to re-run on partially-applied databases.

-- Step 1: Add block_order column with default (IF NOT EXISTS guard)
ALTER TABLE "provider_schedules" ADD COLUMN IF NOT EXISTS "block_order" INTEGER NOT NULL DEFAULT 0;

-- Step 2: Drop the old unique constraint if it exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'provider_schedules_provider_id_day_of_week_key'
      AND table_name = 'provider_schedules'
  ) THEN
    ALTER TABLE "provider_schedules"
      DROP CONSTRAINT "provider_schedules_provider_id_day_of_week_key";
  END IF;
END $$;

-- Step 3: Add new unique constraint (provider_id, day_of_week, block_order)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'provider_schedules_provider_id_day_of_week_block_order_key'
      AND table_name = 'provider_schedules'
  ) THEN
    ALTER TABLE "provider_schedules"
      ADD CONSTRAINT "provider_schedules_provider_id_day_of_week_block_order_key"
      UNIQUE ("provider_id", "day_of_week", "block_order");
  END IF;
END $$;

-- Step 4: Add index for efficient queries
CREATE INDEX IF NOT EXISTS "idx_provider_schedules_lookup"
  ON "provider_schedules"("provider_id", "day_of_week");
