-- =====================================================================
-- No-op migration. Original backfill of store_subscriptions removed
-- before first production deploy (it depended on the legacy plan rows
-- that no longer exist). Subscriptions are created at store-creation
-- time by the regular application flow, not by migration.
-- =====================================================================
SELECT 1;
