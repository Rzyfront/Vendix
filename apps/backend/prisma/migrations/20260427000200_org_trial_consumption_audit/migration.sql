-- =====================================================================
-- DATA IMPACT:
--   Tables affected:
--     - organization_trial_consumptions (CREATE + backfill INSERTs)
--   Tables preserved: organizations, stores, store_subscriptions (read-only)
--   Expected row changes:
--     - +1 row per organization with has_consumed_trial=true that has a
--       resolvable store_subscriptions row (idempotent via ON CONFLICT).
--   Cascade risk: none. FKs declared with ON DELETE RESTRICT to preserve
--     audit trail and block accidental deletes upstream.
--   Idempotent: CREATE TABLE IF NOT EXISTS, DO $$...$$ for FK creation,
--     ON CONFLICT (organization_id) DO NOTHING for backfill.
-- Rationale:
--   Replaces the boolean-only `organizations.has_consumed_trial` flag with
--   an explicit audit row keyed by organization_id (UNIQUE). This lets us
--   detect concurrent trial consumption via the unique constraint (P2002),
--   keep the link to the originating store_subscriptions row, and store
--   arbitrary metadata for future audit needs. The boolean flag remains
--   for back-compat during a 1-release dual-write window.
-- =====================================================================

-- 1. Create the audit table (idempotent).
CREATE TABLE IF NOT EXISTS "organization_trial_consumptions" (
  "id"                    SERIAL        NOT NULL,
  "organization_id"       INTEGER       NOT NULL,
  "store_subscription_id" INTEGER       NOT NULL,
  "consumed_at"           TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata"              JSONB,
  CONSTRAINT "organization_trial_consumptions_pkey" PRIMARY KEY ("id")
);

-- 2. Unique index on organization_id (one trial consumption per org).
CREATE UNIQUE INDEX IF NOT EXISTS "organization_trial_consumptions_organization_id_key"
  ON "organization_trial_consumptions" ("organization_id");

-- 3. Foreign keys (idempotent via duplicate_object exception).
DO $$
BEGIN
  ALTER TABLE "organization_trial_consumptions"
    ADD CONSTRAINT "organization_trial_consumptions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "organization_trial_consumptions"
    ADD CONSTRAINT "organization_trial_consumptions_store_subscription_id_fkey"
    FOREIGN KEY ("store_subscription_id") REFERENCES "store_subscriptions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- 4. Helpful secondary index for lookups by store_subscription_id.
CREATE INDEX IF NOT EXISTS "organization_trial_consumptions_store_subscription_id_idx"
  ON "organization_trial_consumptions" ("store_subscription_id");

-- 5. Backfill from organizations that have already consumed their trial.
--    For each such org, locate its earliest store_subscriptions row by
--    going through stores -> store_subscriptions and pick the row whose
--    state is 'trial' or, failing that, the oldest by created_at. Skip
--    orgs that have no resolvable subscription row (defensive — should
--    not happen in practice, but keeps the migration safe).
INSERT INTO "organization_trial_consumptions" ("organization_id", "store_subscription_id", "consumed_at", "metadata")
SELECT
  o.id                                                AS organization_id,
  ss.id                                               AS store_subscription_id,
  COALESCE(o.trial_consumed_at, ss.created_at, NOW()) AS consumed_at,
  jsonb_build_object('source', 'backfill_20260427000200') AS metadata
FROM "organizations" o
JOIN LATERAL (
  SELECT s2.id AS id, s2.created_at AS created_at
  FROM "store_subscriptions" s2
  JOIN "stores" st ON st.id = s2.store_id
  WHERE st.organization_id = o.id
  ORDER BY
    CASE WHEN s2.state = 'trial' THEN 0 ELSE 1 END,
    s2.created_at ASC
  LIMIT 1
) ss ON TRUE
WHERE o.has_consumed_trial = TRUE
ON CONFLICT ("organization_id") DO NOTHING;
