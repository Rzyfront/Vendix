-- Etiquetas del CRM: a qué grupo pertenece cada etiqueta y cuándo se pone.
--
-- DATA IMPACT:
-- Tables affected:
--   crm_tags: two new nullable columns (group_name VARCHAR(30),
--     description VARCHAR(200)) plus one index on (store_id, group_name).
-- Expected row changes: 0. No UPDATE, no INSERT, no DELETE: the tags that
--   already exist keep NULL in both columns and the app shows them as «Sin
--   grupo» and without note, exactly as it did before this migration.
-- Destructive operations: none (no DROP, no TRUNCATE, no DELETE, no UPDATE,
--   no NOT NULL without default).
-- FK/cascade risk: none. No new foreign keys; the index is plain.
-- Idempotency: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
--   Running it twice changes nothing.

ALTER TABLE "crm_tags" ADD COLUMN IF NOT EXISTS "group_name" VARCHAR(30);
ALTER TABLE "crm_tags" ADD COLUMN IF NOT EXISTS "description" VARCHAR(200);

CREATE INDEX IF NOT EXISTS "crm_tags_store_id_group_name_idx"
  ON "crm_tags"("store_id", "group_name");
