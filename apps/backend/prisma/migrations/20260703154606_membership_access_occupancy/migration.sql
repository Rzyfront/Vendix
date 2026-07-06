-- DATA IMPACT:
-- Tables affected: creates membership_access_occupancy (NEW, starts empty).
-- Expected row changes: none (additive DDL only; 0 rows; no UPDATE/DELETE on existing rows).
-- Destructive operations: none (no DROP / TRUNCATE / unscoped DELETE-UPDATE).
-- FK/cascade risk: FK store_id -> stores(id) uses ON DELETE RESTRICT ON UPDATE CASCADE,
--   matching the sibling membership_* tables (respects CLAUDE.md §6.1: NO cascade on
--   business parents). A single row per store (store_id UNIQUE) acts as the aforo counter.
-- Idempotency: guarded with CREATE TABLE IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS,
--   and pg_constraint existence check on the FK — safe to re-run.
-- Approval: documentada en el plan aprobado (rediseño de Accesos de membresía — control de aforo).

-- 1) Table (IF NOT EXISTS — column types match the sibling membership_* tables)
CREATE TABLE IF NOT EXISTS "membership_access_occupancy" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "current_count" INTEGER NOT NULL DEFAULT 0,
    "business_date" DATE,
    "last_leveled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "membership_access_occupancy_pkey" PRIMARY KEY ("id")
);

-- 2) Unique index on store_id (Prisma @unique naming: one occupancy row per store)
CREATE UNIQUE INDEX IF NOT EXISTS "membership_access_occupancy_store_id_key" ON "membership_access_occupancy"("store_id");

-- 3) Foreign key (guarded via pg_constraint; RESTRICT on the store business parent,
--    identical ON DELETE/ON UPDATE behavior to membership_access_logs_store_id_fkey)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'membership_access_occupancy_store_id_fkey') THEN
    ALTER TABLE "membership_access_occupancy" ADD CONSTRAINT "membership_access_occupancy_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
