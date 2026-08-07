-- QUI-646: add `archived_at` to users for the membership archive flow.
--
-- DATA IMPACT:
-- Tables affected: users
-- Expected row changes: 0. The column is nullable with NO default; every
--   existing row reads NULL ("not archived") which matches the previous
--   behavior (no archive flag existed).
-- Destructive operations: none. No DELETE, no DROP, no TRUNCATE, no CASCADE.
-- FK/cascade risk: none. No constraint is added, dropped or altered.
-- Idempotency: Prisma migrations are tracked in `_prisma_migrations`, so a
--   second apply is a no-op. If run by hand, `ADD COLUMN` of an existing
--   column fails fast — guard by checking before re-applying.
--
-- WHY: the membership module lets a customer be the holder of one or more
-- memberships. Until now there was no way to hide a customer from the list
-- when they no longer wanted to be a member — the only "off" state was
-- `user_state_enum = 'inactive'`, which kills authentication, not the
-- membership entry. `archived_at` is a SOFT DELETE flag scoped to the
-- membership surface; rows are kept (history, FK integrity, audit) but
-- the finders exclude them by default.

ALTER TABLE "users"
  ADD COLUMN "archived_at" TIMESTAMP(6);
