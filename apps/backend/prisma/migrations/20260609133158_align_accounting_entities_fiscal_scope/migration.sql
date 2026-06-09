-- DATA IMPACT:
-- Tables affected: accounting_entities
-- Expected row changes: UPDATE fiscal_scope -> 'ORGANIZATION' on rows where
--   scope='ORGANIZATION' AND fiscal_scope <> 'ORGANIZATION' (legacy rows created
--   before fiscal_scope was set explicitly on write; column default was 'STORE').
--   Expected count is low (at most one row per organization; 1 row in dev).
-- Destructive operations: none (no DELETE, no DROP, no TRUNCATE)
-- FK/cascade risk: none (only an enum column value changes; PK/FKs untouched)
-- Idempotency: guarded by WHERE fiscal_scope <> 'ORGANIZATION' and a NOT EXISTS
--   anti-collision guard against the unique constraint
--   accounting_entities_org_store_scope_fiscal_scope_key
--   (organization_id, store_id, scope, fiscal_scope).
-- Approval: documented in chat (approved plan: align accounting_entities
--   fiscal_scope with read-side predicate in StorePrismaService).

UPDATE accounting_entities ae
SET fiscal_scope = 'ORGANIZATION'::fiscal_scope_enum
WHERE ae.scope = 'ORGANIZATION'
  AND ae.fiscal_scope <> 'ORGANIZATION'
  AND NOT EXISTS (
    SELECT 1 FROM accounting_entities x
    WHERE x.organization_id = ae.organization_id
      AND x.store_id IS NOT DISTINCT FROM ae.store_id
      AND x.scope = ae.scope
      AND x.fiscal_scope = 'ORGANIZATION'
      AND x.id <> ae.id
  );
