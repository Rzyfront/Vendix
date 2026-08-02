-- DATA IMPACT:
-- Tables affected: dian_configurations (columns test_set_id, software_id, nit)
-- Expected row changes: 0 rows in production. Verified 2026-08-01 against the
--   production database: every row already satisfies `col = btrim(col)`
--   (config 12 / HIDRO: len(test_set_id)=36, len(software_id)=36, no whitespace).
--   This migration is a defensive net so any row written before the DTO-level
--   `@TrimString()` guard cannot keep a stray character.
-- Destructive operations: none. Only surrounding whitespace is removed; no DELETE,
--   no DROP, no CASCADE, no TRUNCATE. A value's meaningful content is never altered.
-- FK/cascade risk: none — no foreign key references these columns.
-- Idempotency: the WHERE clause makes re-running a no-op; btrim is a fixed point.
-- Approval: user requested a full fix of the DIAN habilitación flow (2026-08-01),
--   explicitly including trim/parsing defects.
-- Snapshot: not required — no row content is destroyed and the change is reversible
--   only in the sense that trailing whitespace was never meaningful data.
--
-- Context: a DIAN TestSetId or SoftwareID pasted from the portal can carry a
-- trailing space. The DIAN treats it as a real character and silently discards
-- the batch, which is indistinguishable from a queued batch. The permanent fix
-- is `@TrimString()` + `@IsUUID()` in the DTOs; this statement cleans whatever
-- was persisted before that guard existed.

UPDATE "dian_configurations"
SET "test_set_id" = btrim("test_set_id")
WHERE "test_set_id" IS NOT NULL
  AND "test_set_id" <> btrim("test_set_id");

UPDATE "dian_configurations"
SET "software_id" = btrim("software_id")
WHERE "software_id" <> btrim("software_id");

UPDATE "dian_configurations"
SET "nit" = btrim("nit")
WHERE "nit" <> btrim("nit");
