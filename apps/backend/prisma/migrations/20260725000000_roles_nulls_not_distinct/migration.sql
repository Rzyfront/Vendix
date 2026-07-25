-- QUI-473 follow-up: enforce system role uniqueness at the DB level.
--
-- The previous composite unique on (organization_id, name) used the Postgres
-- default `NULLS DISTINCT` semantics, which means two rows with
-- (NULL, 'admin') were considered DIFFERENT and both could be inserted.
-- That left system-role uniqueness enforced only by application code, which
-- is fragile (a race between the pre-check and the INSERT can bypass it).
--
-- Switching to `NULLS NOT DISTINCT` (PostgreSQL 15+) makes NULL values
-- compare equal, so (NULL, 'admin') and (NULL, 'admin') collide. This
-- restores the original invariant — "system roles (organization_id IS NULL)
-- must have unique names" — at the database layer, where it belongs.
--
-- Existing data: the live roles table has 10 system rows, all with distinct
-- names, so the recreated index succeeds without conflicts.

DROP INDEX IF EXISTS "roles_organization_id_name_key";

CREATE UNIQUE INDEX "roles_organization_id_name_key"
  ON "roles"("organization_id", "name")
  NULLS NOT DISTINCT;
