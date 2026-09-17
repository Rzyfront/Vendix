-- DATA IMPACT:
-- Tables affected: store_settings
-- Expected row changes: adds two boolean keys, `analytics_dispatch` and
--   `reports_dispatch`, under settings.panel_ui.STORE_ADMIN for every
--   existing row with a non-null `settings` JSON (16/16 rows in local dev
--   as of 2026-09-12). Every other key already present anywhere in
--   `settings` (including other panel_ui.STORE_ADMIN keys and
--   panel_ui.STORE_ECOMMERCE) is left byte-for-byte untouched, because the
--   jsonb `||` merge operator only overwrites the keys explicitly listed on
--   its right-hand side.
-- Destructive operations: none. No DELETE/TRUNCATE/DROP; UPDATE always
--   carries WHERE settings IS NOT NULL.
-- FK/cascade risk: none (JSON column only, no FK-bearing columns touched).
-- Idempotency: COALESCE reads any value already stored for these two keys
--   before writing, so re-running this migration is a no-op that writes
--   back the same values it already found (verified by construction, not
--   by a WHERE guard, because the goal is "backfill/repair" for any row
--   that is missing the keys, not "run once and never touch again").
-- Approval: paso 6 of docs/plans/PLAN-analytics-despachos-2026-09-12.md.
--   Keys are seeded to `true` because the industry-based gating (paso 7 of
--   the same plan) is what decides real per-industry visibility; seeding
--   `false` would hide the new "Despachos" analytics/reports category even
--   for retail stores until an admin toggled it by hand.
--
-- DEVIATION FROM THE REQUESTED TEMPLATE (documented per instructions):
-- The task asked to copy
-- `20260419200000_update_panel_ui_analytics_keys/migration.sql` as the exact
-- mold. That migration rebuilds the ENTIRE `settings.panel_ui` object as a
-- flat `jsonb_build_object(...)` (e.g. `panel_ui.analytics_financial`), with
-- no `STORE_ADMIN`/`STORE_ECOMMERCE` nesting. A direct copy would silently
-- replace the real shape with a flat one and drop every other panel_ui key.
-- A live read of local `store_settings` (`docker exec vendix_postgres psql
-- -U username -d vendix_db -c "SELECT settings->'panel_ui' FROM
-- store_settings LIMIT 5;"`) confirms the actual/current shape is nested:
-- `settings.panel_ui.STORE_ADMIN.<key>` / `settings.panel_ui.STORE_ECOMMERCE.<key>`,
-- matching `PanelUISettings` in
-- apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts
-- (`{ STORE_ADMIN?: Record<string, boolean>; STORE_ECOMMERCE?: Record<string, boolean>; }`)
-- and `default-store-settings.ts` (`panel_ui: { STORE_ADMIN: { ... } }`).
-- The 2026-04-19 migration's flat shape never matched production data; it
-- was a no-op in every environment because its WHERE guard
-- (`settings->'panel_ui' ? 'analytics_traffic' OR ... ? 'analytics_performance'`)
-- never matched any row (confirmed applied-but-inert via `_prisma_migrations`
-- locally: finished_at is set, and current data is still correctly nested).
-- This migration therefore uses `jsonb_set` + `||` merge scoped to
-- `panel_ui.STORE_ADMIN` instead, so it adds the two new keys without
-- disturbing the nested shape or any sibling key. Also scoped to
-- `store_settings` only: `organization_settings.settings` has no `panel_ui`
-- key in any row locally (verified), so there is nothing to backfill there
-- and touching it would be a no-op with extra risk for no benefit.

UPDATE store_settings
SET settings = jsonb_set(
    COALESCE(settings, '{}'::jsonb),
    '{panel_ui}',
    COALESCE(settings->'panel_ui', '{}'::jsonb) || jsonb_build_object(
        'STORE_ADMIN',
        COALESCE(settings->'panel_ui'->'STORE_ADMIN', '{}'::jsonb) || jsonb_build_object(
            'analytics_dispatch',
            COALESCE((settings->'panel_ui'->'STORE_ADMIN'->>'analytics_dispatch')::boolean, true),
            'reports_dispatch',
            COALESCE((settings->'panel_ui'->'STORE_ADMIN'->>'reports_dispatch')::boolean, true)
        )
    ),
    true
)
WHERE settings IS NOT NULL;
