-- DATA IMPACT:
-- Tables affected: organizations (additive: is_platform column + partial UNIQUE index)
-- Expected row changes: 0 destructive mutations. Purely additive: new nullable column,
--   a UNIQUE partial index that allows at most ONE organization to be the Vendix platform.
-- Destructive operations: none. No DROP, TRUNCATE, DELETE, or UPDATE.
-- FK/cascade risk: none. No FK changes; no existing FK semantics touched.
-- Idempotency: guarded by IF NOT EXISTS on the index, and ADD COLUMN IF NOT EXISTS
--   with a server-side default of FALSE so existing orgs are unaffected.
-- Approval: Step 1 of approved plan (Módulo Fiscal Unificado para VENDIX_ADMIN).

-- ===== Column =====
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "is_platform" BOOLEAN NOT NULL DEFAULT FALSE;

-- ===== Partial UNIQUE INDEX =====
-- At most one organization can be the Vendix platform. NULL/FALSE values
-- are excluded by the WHERE clause so tenant orgs are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_is_platform_unique"
  ON "organizations" ("is_platform")
  WHERE "is_platform" = TRUE;
