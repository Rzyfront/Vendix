-- DATA IMPACT:
-- Tables affected: users
-- Expected row changes: none (only relaxes the NOT NULL constraint on users.email)
-- Destructive operations: none
-- FK/cascade risk: none (no constraints depend on this column's nullability)
-- Idempotency: DROP NOT NULL is idempotent by nature; re-running is a no-op
-- Approval: requested by user — make customer email truly optional (null), no fake placeholders

-- Make users.email optional so customers can be created/updated without an email.
-- Login-capable users (owners/staff) still receive an email via their own DTOs.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
