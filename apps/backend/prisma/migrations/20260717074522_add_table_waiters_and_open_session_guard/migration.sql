-- DATA IMPACT:
-- Tables affected:
--   NEW TABLE       table_waiters            (0 filas iniciales)
--   NEW INDEX       table_waiters_table_id_user_id_key (UNIQUE)
--   NEW INDEX       table_waiters_user_id_idx
--   NEW CONSTRAINT  table_waiters_table_id_fkey (FK -> tables.id, ON DELETE CASCADE)
--   NEW CONSTRAINT  table_waiters_user_id_fkey  (FK -> users.id,  ON DELETE CASCADE)
--   NEW INDEX       table_sessions_one_open_per_table (partial UNIQUE)
-- Expected row changes: NONE. No backfill. No UPDATE / DELETE / TRUNCATE.
-- Destructive operations: NONE.
-- FK/cascade risk:
--   - table_waiters.table_id  -> tables.id  ON DELETE CASCADE
--   - table_waiters.user_id   -> users.id   ON DELETE CASCADE
--   Both follow the same pattern as `employee_stores` (Pivot N:M with
--   onDelete: Cascade on the parent relations) and are acceptable for a
--   pure pivot row: when a table is deleted, its waiter assignments go
--   with it; when a user is deleted, their waiter assignments go with
--   them. No business parent loses rows silently because table_waiters
--   is itself a leaf pivot.
-- Idempotency:
--   - CREATE TABLE IF NOT EXISTS
--   - CREATE UNIQUE INDEX IF NOT EXISTS
--   - CREATE INDEX IF NOT EXISTS
--   - DO $$ ... IF NOT EXISTS (pg_constraint) ... END $$ for FKs
--   All statements can be re-applied safely (drift recovery, partial
--   failure replay) without raising duplicate-object errors.
-- Partial unique index rationale:
--   - table_sessions_one_open_per_table enforces "at most ONE open
--     session per table" at the DB level. WHERE closed_at IS NULL lets
--     historical (closed) sessions pile up freely while still blocking
--     the check-then-act race that the dine-in QR flow had when two
--     scans raced to open the same table.
-- Approval: additive migration, zero destructive ops; follows
--   vendix-prisma-migrations mandatory safety rules. Referenced in
--   plan typed-meandering-turtle.md (QR-de-mesa restructure, Step 1).

-- =====================================================================
-- STEP 1: New pivot table `table_waiters` (waiter <-> table).
-- =====================================================================
CREATE TABLE IF NOT EXISTS "table_waiters" (
    "id"          BIGSERIAL                NOT NULL,
    "table_id"    INTEGER                  NOT NULL,
    "user_id"     INTEGER                  NOT NULL,
    "assigned_at" TIMESTAMP(6)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "table_waiters_pkey" PRIMARY KEY ("id")
);

-- =====================================================================
-- STEP 2: Composite unique index (prevents duplicate assignments).
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS "table_waiters_table_id_user_id_key"
    ON "table_waiters"("table_id", "user_id");

-- =====================================================================
-- STEP 3: Secondary index on user_id for "tables served by waiter X" reads.
-- =====================================================================
CREATE INDEX IF NOT EXISTS "table_waiters_user_id_idx"
    ON "table_waiters"("user_id");

-- =====================================================================
-- STEP 4: FK table_id -> tables.id  (guarded, idempotent).
-- =====================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'table_waiters_table_id_fkey'
    ) THEN
        ALTER TABLE "table_waiters"
            ADD CONSTRAINT "table_waiters_table_id_fkey"
            FOREIGN KEY ("table_id") REFERENCES "tables"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- =====================================================================
-- STEP 5: FK user_id -> users.id  (guarded, idempotent).
-- =====================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'table_waiters_user_id_fkey'
    ) THEN
        ALTER TABLE "table_waiters"
            ADD CONSTRAINT "table_waiters_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- =====================================================================
-- STEP 6: Partial unique index — one open session per table.
--   Hardening for the QR-de-mesa open_tab race (check-then-act).
--   WHERE closed_at IS NULL allows many historical (closed) rows but
--   blocks a second concurrent OPEN row for the same table_id.
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS "table_sessions_one_open_per_table"
    ON "table_sessions"("table_id")
    WHERE "closed_at" IS NULL;
