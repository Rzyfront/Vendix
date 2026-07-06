-- DATA IMPACT:
-- Tables affected: none.
-- Enum changes: membership_access_result_enum += 'denied_capacity_full'
--   (idempotent ADD VALUE; value is NOT used in this migration's DDL, so the
--   Postgres same-transaction ADD VALUE restriction does not apply).
-- Expected row changes: none.
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: guarded with ADD VALUE IF NOT EXISTS — safe to re-run.
-- Approval: documentada en el plan aprobado (rediseño de Accesos de membresía — control de aforo).

ALTER TYPE "membership_access_result_enum" ADD VALUE IF NOT EXISTS 'denied_capacity_full';
