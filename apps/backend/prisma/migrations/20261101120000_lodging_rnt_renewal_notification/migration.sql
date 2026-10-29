-- Hospitality Suite (H4.3) — notification type of the yearly reminder to renew
-- the hotel's Registro Nacional de Turismo (RNT) before March 31.
--
-- DATA IMPACT:
-- Tables affected: none (only adds one value to the enum).
-- Expected row changes: 0.
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: ADD VALUE IF NOT EXISTS.
-- Skill: vendix-prisma-migrations (Rule 1).

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'lodging_rnt_renewal';
