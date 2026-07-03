-- DATA IMPACT:
-- Tables affected: none.
-- Enum changes: membership_access_result_enum += 'denied_outside_schedule'
--   (idempotent ADD VALUE; value is NOT used in this migration's DDL).
-- Expected row changes: none.
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: guarded with ADD VALUE IF NOT EXISTS — safe to re-run.
-- Approval: documentada en el plan aprobado (W2 — control de acceso fuera de horario).

ALTER TYPE "membership_access_result_enum" ADD VALUE IF NOT EXISTS 'denied_outside_schedule';
