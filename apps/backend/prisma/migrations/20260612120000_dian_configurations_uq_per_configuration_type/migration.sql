-- DATA IMPACT:
-- Tables affected: dian_configurations (schema only — partial unique indexes only)
-- Expected row changes: none. Existing rows have a single configuration_type
--                      ('invoicing') per scope, so widening the partial unique
--                      indexes to include configuration_type does not violate
--                      any existing row pair.
-- Destructive operations: drops two partial unique indexes
--                         (dian_configurations_store_scope_uq,
--                          dian_configurations_org_scope_uq) and immediately
--                         recreates them with configuration_type added to the
--                         key. No row data is touched.
-- FK/cascade risk: none. Indexes do not affect FK behavior.
-- Idempotency: guarded by DROP INDEX IF EXISTS / CREATE INDEX IF NOT EXISTS.
-- Reversibility: trivial — drop the new indexes and recreate the legacy ones
--                without configuration_type. No data loss in either direction
--                because there is at most one row per (scope, nit) today.
-- Approval: required to unblock platform vendor_support_document fiscal flow
--           (clone of invoicing config into a sibling configuration_type=
--           'support_document' row was blocked by the legacy idx).

BEGIN;

-- Drop legacy partial unique indexes that scoped uniqueness only by
-- (store_id, nit) and (organization_id, nit), without considering
-- configuration_type. With multiple configuration_type values per accounting
-- entity (invoicing + support_document + payroll + …), uniqueness must include
-- configuration_type so the platform can hold sibling configurations.
DROP INDEX IF EXISTS "dian_configurations_store_scope_uq";
DROP INDEX IF EXISTS "dian_configurations_org_scope_uq";

-- Recreate with configuration_type included in the key.
-- STORE-scoped rows: unique by (store_id, nit, configuration_type)
-- when store_id IS NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "dian_configurations_store_scope_uq"
  ON "dian_configurations" ("store_id", "nit", "configuration_type")
  WHERE "store_id" IS NOT NULL;

-- ORG-scoped rows: unique by (organization_id, nit, configuration_type)
-- when store_id IS NULL. This is what the platform fiscal flow requires:
-- one row per (org, nit, configuration_type) so vendor_support_documents can
-- clone the invoicing config into a configuration_type='support_document'
-- sibling row.
CREATE UNIQUE INDEX IF NOT EXISTS "dian_configurations_org_scope_uq"
  ON "dian_configurations" ("organization_id", "nit", "configuration_type")
  WHERE "store_id" IS NULL;

COMMIT;
