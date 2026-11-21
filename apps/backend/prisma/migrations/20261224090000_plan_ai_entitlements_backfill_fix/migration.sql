-- Corrective follow-up of the plan_ai_entitlements backfill
-- (odd/tasks/vex-agente-avanzado.md §3.11, T11; audit findings F1 and F6).
-- M2 (20261223090000) and M3 (20261223100000) are NOT edited: they may already
-- be applied somewhere, and Prisma checksums every applied file.
--
-- What was wrong in M3:
--   F1: the live gate only blocks a legacy feature when it is missing or
--     `enabled === false` (subscription-access.service.ts). M3 copied
--     `enabled` as true only for the JSON boolean true, so a feature object
--     without `enabled` (or with `"true"` as text, or null) that has access
--     today was copied as OFF.
--   F6: a fractional legacy cap between 0 and 1 was truncated to 0, which in
--     the new model means "nothing". The rule is: a cap that truncates to 0
--     is "no limit" (NULL), never 0.
--
-- What this migration does (one bounded UPDATE over plan_ai_entitlements):
--   (a) enabled = false  ->  true  when the source legacy feature in
--       subscription_plans.ai_feature_flags is a JSON object whose `enabled`
--       is not the JSON boolean false (missing, null, text, number...).
--   (b) cap_value = 0    ->  NULL  when the source legacy cap is a JSON number
--       strictly between 0 and 1.
--   The capability -> legacy feature / cap field mapping is the VALUES list of
--   M3, copied verbatim (the spec ai-entitlements.migration.spec.ts checks it
--   against the catalog). Rows with no legacy source are never touched.
--   Only rows that are still the backfill's are touched: updated_at =
--   created_at. M3 inserted every row with both columns at the same
--   CURRENT_TIMESTAMP, and every write of the app (Prisma @updatedAt) moves
--   updated_at, so a row a superadmin edited after M3 keeps being skipped.
--   Limit of that proof: a raw SQL edit that does not touch updated_at is
--   indistinguishable from the backfill; there is no other column that proves
--   it (M2 has no author or version column).
--   updated_at is left as is on purpose, so the predicate stays provable.
--
-- Read-only pre-check from the audit (rows whose legacy feature has a
-- non-boolean `enabled`); run it before applying:
--   SELECT p.id, p.code, f.key
--   FROM subscription_plans p, jsonb_each(p.ai_feature_flags) f
--   WHERE jsonb_typeof(f.value) = 'object'
--     AND jsonb_typeof(f.value -> 'enabled') IS DISTINCT FROM 'boolean';
-- and, for the rows this migration would change, the same predicate as a
-- SELECT: replace "UPDATE ... SET ..." below by "SELECT e.* FROM
-- plan_ai_entitlements e JOIN (<the sub-select f>) ..." with the same WHERE.
--
-- DATA IMPACT:
--   Tables affected: plan_ai_entitlements (UPDATE of enabled / cap_value).
--     subscription_plans is only read.
--   Rows affected: only rows written by M3 (updated_at = created_at) of plans
--     whose legacy JSON has features without a boolean `enabled` or fractional
--     caps (0 < cap < 1). Seeds always write booleans and integer caps, so the
--     expected count in production is 0. Count before applying: the pre-check
--     above, plus
--       SELECT count(*) FROM plan_ai_entitlements e
--       WHERE e.updated_at = e.created_at AND (NOT e.enabled OR e.cap_value = 0);
--     as an upper bound.
--   Destructive operations: none. No DELETE, TRUNCATE, DROP or CASCADE; the
--     UPDATE has a WHERE and never rewrites a row to a narrower access.
--   FK/cascade risk: none. plan_ai_entitlements is a child of
--     subscription_plans (ON DELETE RESTRICT) and nothing references it.
--   Idempotency: after the first run the rows no longer match the WHERE
--     (enabled = true, cap_value NULL); re-running changes nothing.
--   Dry-run: not executed on this machine (no Postgres or Docker). The real
--     SQL of M2 + M3 + this file is executed against pglite by
--     ai-entitlements.migration.sql.spec.ts with fixtures.
--   Approval: the shape (bounded UPDATE over rows M3 itself produced wrong,
--     with rollback explained) is authorized by the implementation brief of
--     phase 2 follow-ups. Rafael's production GO is PENDING: it still needs a
--     production snapshot, a dry-run over the real plans and his explicit GO
--     at release.
--   Rollback: before applying, list the affected rows with the read-only
--     queries above and keep that list; ai_feature_flags is untouched, so the
--     gate (which decides with it) loses nothing. plan_ai_entitlements does
--     not decide access while AI_ENTITLEMENTS_MODE=shadow, so the corrected
--     rows can simply stay. To revert, a new migration would set enabled =
--     false / cap_value = 0 for exactly the listed (plan_id, agent_key,
--     capability_key) rows, with its own DATA IMPACT and approval.

UPDATE "plan_ai_entitlements" AS e
SET
  "enabled" = e."enabled" OR f.fix_enabled,
  "cap_value" = CASE WHEN f.fix_cap THEN NULL ELSE e."cap_value" END
FROM (
  SELECT
    p."id" AS plan_id,
    s.agent_key,
    s.capability_key,
    COALESCE(
      s.source_feature IS NOT NULL
        AND s.enabled_from = 'feature'
        AND jsonb_typeof(p."ai_feature_flags" -> s.source_feature) = 'object'
        AND (p."ai_feature_flags" -> s.source_feature -> 'enabled')
          IS DISTINCT FROM 'false'::jsonb,
      false
    ) AS fix_enabled,
    -- Nested WHEN, not AND: Postgres does not promise AND evaluation order, and
    -- the ::numeric cast must never run on a non-numeric JSON value.
    CASE
      WHEN s.cap_field IS NULL THEN false
      WHEN jsonb_typeof(p."ai_feature_flags" -> s.source_feature -> s.cap_field)
        IS DISTINCT FROM 'number' THEN false
      WHEN (p."ai_feature_flags" -> s.source_feature ->> s.cap_field)::numeric > 0
        AND (p."ai_feature_flags" -> s.source_feature ->> s.cap_field)::numeric < 1
        THEN true
      ELSE false
    END AS fix_cap
  FROM "subscription_plans" p
  CROSS JOIN (
    VALUES
      ('vex', 'agent', 'vex_agent', 'feature', 'daily_messages_cap'),
      ('vex', 'model_tokens', 'vex_agent', 'always', 'monthly_tokens_cap'),
      ('vex', 'voice_readout', 'realtime_voice', 'feature', 'monthly_voice_seconds_cap'),
      ('vex', 'files', 'vex_agent', 'feature', NULL),
      ('vex', 'code_analysis', NULL, NULL, NULL),
      ('vex', 'advanced_model', NULL, NULL, NULL),
      ('vexi', 'agent', 'streaming_chat', 'feature', 'daily_messages_cap'),
      ('vexi', 'model_tokens', 'text_generation', 'always', 'monthly_tokens_cap'),
      ('vexi', 'voice_readout', 'realtime_voice', 'feature', 'monthly_voice_seconds_cap'),
      ('platform', 'module_ai', 'text_generation', 'feature', 'monthly_tokens_cap'),
      ('platform', 'smart_search', 'rag_embeddings', 'feature', 'indexed_docs_cap')
  ) AS s (agent_key, capability_key, source_feature, enabled_from, cap_field)
) AS f
WHERE e."plan_id" = f.plan_id
  AND e."agent_key" = f.agent_key
  AND e."capability_key" = f.capability_key
  AND e."updated_at" = e."created_at"
  AND (
    (NOT e."enabled" AND f.fix_enabled)
    OR (e."cap_value" = 0 AND f.fix_cap)
  );
