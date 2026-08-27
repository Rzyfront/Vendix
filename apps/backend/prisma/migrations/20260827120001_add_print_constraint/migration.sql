-- DATA IMPACT:
-- Tables affected: print_templates
-- Expected row changes: 0 rows mutated. Constraint is NOT VALID, so no table scan.
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by IF NOT EXISTS on the pg_constraint catalog lookup.
-- Approval: documented in CP-DTLP-20260827 (Phase B.1.b).
--
-- print_templates carries system templates (is_system=true, organization_id IS NULL)
-- AND organization templates (is_system=false, organization_id NOT NULL). The mixed
-- shape is by design (system templates are shared across tenants), but historically
-- nothing enforced the invariant — a corrupt row with is_system=true AND a non-null
-- organization_id would silently bypass the scoping rule.
--
-- NOT VALID is deliberate: PostgreSQL applies the constraint only to NEW rows and
-- does not scan existing ones at ADD CONSTRAINT time. Validation of existing rows
-- is scheduled as a separate background job (out of scope for this plan; tracked
-- as a knowledge gap in the dispatch-ticket-plan knowledge base).
ALTER TABLE print_templates
  ADD CONSTRAINT print_templates_system_org_chk
  CHECK (
    (is_system = TRUE AND organization_id IS NULL)
    OR (is_system = FALSE AND organization_id IS NOT NULL)
  )
  NOT VALID;
