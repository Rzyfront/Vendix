-- DATA IMPACT:
-- Tables affected: lodging_reservation_rooms (schema only). Adds the nullable
-- column cancelled_at: when one room of a multi-room reservation is cancelled
-- while the others stay active (H1.5). NULL = active room.
-- Expected row changes: none. Existing rows keep NULL (active), as today.
-- Destructive operations: none.
-- FK/cascade risk: none. No constraint added or changed.
-- Idempotency: ADD COLUMN IF NOT EXISTS.
-- Approval: hospitality plan, slice H1.5 (owner decisions 2026-10-26).

ALTER TABLE "lodging_reservation_rooms" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(6);
