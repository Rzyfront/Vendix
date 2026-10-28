-- DATA IMPACT:
-- Tables affected: none existing. Creates lodging_night_audits (empty), one
-- closed (or reopened) business day per hotel store.
-- Expected row changes: none.
-- Destructive operations: none.
-- FK/cascade risk: none. The store FK uses ON DELETE RESTRICT.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H7.1 (owner decisions 2026-10-26).

CREATE TABLE IF NOT EXISTS "lodging_night_audits" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "business_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'closed',
    "summary" JSONB NOT NULL,
    "closed_by_user_id" INTEGER,
    "closed_at" TIMESTAMP(6) NOT NULL,
    "reopened_by_user_id" INTEGER,
    "reopened_at" TIMESTAMP(6),
    "reopen_reason" VARCHAR(500),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_night_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_night_audits_store_id_business_date_key"
  ON "lodging_night_audits"("store_id", "business_date");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_night_audits_store_id_fkey') THEN
    ALTER TABLE "lodging_night_audits" ADD CONSTRAINT "lodging_night_audits_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
