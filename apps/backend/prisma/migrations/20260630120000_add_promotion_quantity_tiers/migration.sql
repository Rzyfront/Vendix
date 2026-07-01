-- DATA IMPACT:
-- Tables affected: promotions (additive), promotion_quantity_tiers (new)
-- Expected row changes: none — new column has DEFAULT 'flat', preserving
--   behaviour of every existing promotion.
-- Destructive operations: none
-- FK/cascade risk: promotion_quantity_tiers has ON DELETE CASCADE on
--   promotion_id, matching the pattern used by promotion_products and
--   promotion_categories (already ship ON DELETE CASCADE on promotion_id).
-- Idempotency: enum value guarded via pg_enum check; column add uses
--   IF NOT EXISTS; table / index / unique constraint created with
--   IF NOT EXISTS guards.
-- Approval: documented in the parallel-orchestration plan for the
--   quantity_tiered promotion method feature.

-- =====================================================================
-- Step 1: add the new enum value (idempotent)
-- =====================================================================
-- The new rule_type enum distinguishes between flat (existing behaviour)
-- and quantity_tiered (volume breaks defined in promotion_quantity_tiers).
-- We add both values with a guard so the migration is safe to re-apply
-- if a previous run partially succeeded.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'promotion_rule_type_enum' AND e.enumlabel = 'flat') THEN
    CREATE TYPE "promotion_rule_type_enum" AS ENUM ('flat', 'quantity_tiered');
  END IF;
END
$$;

-- Defensive: if the enum already exists but only has one of the two
-- values (e.g. someone ran a partial custom migration), add the missing
-- value(s) idempotently. Postgres requires ADD VALUE outside a tx block;
-- Prisma wraps migrations in a single transaction, so for the typical
-- Prisma migrate-dev path we do not split this. If the enum does not
-- exist yet, the CREATE TYPE above already inserted both values, so this
-- block becomes a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'promotion_rule_type_enum') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'promotion_rule_type_enum' AND e.enumlabel = 'flat') THEN
      ALTER TYPE "promotion_rule_type_enum" ADD VALUE 'flat';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'promotion_rule_type_enum' AND e.enumlabel = 'quantity_tiered') THEN
      ALTER TYPE "promotion_rule_type_enum" ADD VALUE 'quantity_tiered';
    END IF;
  END IF;
END
$$;

-- =====================================================================
-- Step 2: add rule_type column to promotions
-- =====================================================================
-- DEFAULT 'flat' preserves existing behaviour for every current row.
-- IF NOT EXISTS keeps the migration safe to re-apply.
-- =====================================================================

ALTER TABLE "promotions"
  ADD COLUMN IF NOT EXISTS "rule_type" "promotion_rule_type_enum" NOT NULL DEFAULT 'flat';

-- =====================================================================
-- Step 3: create promotion_quantity_tiers
-- =====================================================================
-- Volume-break tiers. A promotion with rule_type='quantity_tiered' may
-- have any number of tiers (1..N) ordered by min_quantity. max_quantity
-- is NULL on the last tier to mean "open-ended" (>= the previous tier's
-- min). type mirrors promotion_type_enum (percentage / fixed_amount)
-- so each tier can independently express its discount shape.
-- =====================================================================

CREATE TABLE IF NOT EXISTS "promotion_quantity_tiers" (
  "id"            SERIAL                   NOT NULL,
  "promotion_id"  INTEGER                  NOT NULL,
  "min_quantity"  INTEGER                  NOT NULL,
  "max_quantity"  INTEGER,
  "type"          "promotion_type_enum"    NOT NULL,
  "value"         DECIMAL(12, 2)           NOT NULL,
  "sort_order"    INTEGER                  NOT NULL DEFAULT 0,
  CONSTRAINT "promotion_quantity_tiers_pkey" PRIMARY KEY ("id")
);

-- Unique (promotion_id, min_quantity) — no two tiers of the same
-- promotion can start at the same quantity.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'promotion_quantity_tiers_promotion_id_min_quantity_key'
  ) THEN
    ALTER TABLE "promotion_quantity_tiers"
      ADD CONSTRAINT "promotion_quantity_tiers_promotion_id_min_quantity_key"
      UNIQUE ("promotion_id", "min_quantity");
  END IF;
END
$$;

-- FK to promotions — ON DELETE CASCADE matches promotion_products /
-- promotion_categories pattern; deleting a promotion purges its tiers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'promotion_quantity_tiers_promotion_id_fkey'
  ) THEN
    ALTER TABLE "promotion_quantity_tiers"
      ADD CONSTRAINT "promotion_quantity_tiers_promotion_id_fkey"
      FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- Index for the dominant access path: tiers of a promotion, in order.
CREATE INDEX IF NOT EXISTS "promotion_quantity_tiers_promotion_id_idx"
  ON "promotion_quantity_tiers"("promotion_id");