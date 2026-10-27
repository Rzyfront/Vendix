-- DATA IMPACT:
-- Tables affected: lodging_rate_plans, lodging_reservation_rooms and
--   lodging_reservations get new columns (nullable or with a default); no row
--   values change. Creates lodging_cancellation_policies (empty).
-- Expected row changes: none.
-- Destructive operations: none.
-- FK/cascade risk: none. New FK uses ON DELETE RESTRICT.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H2.4 (owner decisions 2026-10-26).

-- Cancellation policy of a rate plan: penalty windows and no-show penalty.
CREATE TABLE IF NOT EXISTS "lodging_cancellation_policies" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "no_show_penalty" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_cancellation_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_cancellation_policies_store_id_name_key" ON "lodging_cancellation_policies"("store_id", "name");
CREATE INDEX IF NOT EXISTS "lodging_cancellation_policies_store_id_is_active_idx" ON "lodging_cancellation_policies"("store_id", "is_active");

-- Plan: policy and deposit (% of the stay) asked when booking.
ALTER TABLE "lodging_rate_plans" ADD COLUMN IF NOT EXISTS "cancellation_policy_id" INTEGER;
ALTER TABLE "lodging_rate_plans" ADD COLUMN IF NOT EXISTS "deposit_percent" DECIMAL(5,2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "lodging_rate_plans_cancellation_policy_id_idx" ON "lodging_rate_plans"("cancellation_policy_id");

-- Sold room: snapshot of the policy and deposit of its plan.
ALTER TABLE "lodging_reservation_rooms" ADD COLUMN IF NOT EXISTS "cancellation_policy_snapshot" JSONB;
ALTER TABLE "lodging_reservation_rooms" ADD COLUMN IF NOT EXISTS "deposit_percent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- Reservation: penalty computed on cancellation or no-show (charged in H3.5).
ALTER TABLE "lodging_reservations" ADD COLUMN IF NOT EXISTS "cancellation_penalty_amount" DECIMAL(14,2);
ALTER TABLE "lodging_reservations" ADD COLUMN IF NOT EXISTS "cancellation_penalty_detail" VARCHAR(200);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_cancellation_policies_store_id_fkey') THEN
    ALTER TABLE "lodging_cancellation_policies" ADD CONSTRAINT "lodging_cancellation_policies_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_rate_plans_cancellation_policy_id_fkey') THEN
    ALTER TABLE "lodging_rate_plans" ADD CONSTRAINT "lodging_rate_plans_cancellation_policy_id_fkey"
      FOREIGN KEY ("cancellation_policy_id") REFERENCES "lodging_cancellation_policies"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_rate_plans_deposit_percent_check') THEN
    ALTER TABLE "lodging_rate_plans" ADD CONSTRAINT "lodging_rate_plans_deposit_percent_check"
      CHECK ("deposit_percent" >= 0 AND "deposit_percent" <= 100);
  END IF;
END $$;
