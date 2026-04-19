-- =============================================================================
-- DATA IMPACT:
--   Module:           Habeas Data (Proteccion de Datos Personales)
--   Tables dropped:   user_consents, data_export_requests, anonymization_requests
--   Enums dropped:    consent_type_enum, data_export_status_enum, anonymization_status_enum
--   Rows destroyed:   ALL rows in the 3 tables (entire module being removed)
--   Inbound FKs:      NONE (verified via schema.prisma - tables are leaf nodes)
--   Outbound FKs:     user_consents.user_id, data_export_requests.user_id,
--                     anonymization_requests.user_id/requested_by_user_id
--                     (dropped automatically with their owning tables - no CASCADE needed)
--   Tables preserved: users (only referenced, never modified)
--
--   User approval:    Rafael Martinez (founder) - 2026-04-19 via annotation in
--                     /admin/pos sidebar: "Quita totalmente este modulo de Datos Personales"
--                     Plan approved: /Users/rzy/.claude/plans/webpage-annotations-dynamic-barto.md
--   Snapshot:         REQUIRED before prod deploy - take RDS snapshot
--                     "vendix-prod-20260419-pre-habeas-drop" or equivalent.
--   Compliance note:  Removes habeas data (Colombian Ley 1581) tracking. If there is
--                     any legal retention obligation, confirm before deploying to prod.
--
-- SAFETY:
--   - No CASCADE keyword used (banned by CLAUDE.md Rule 7)
--   - IF EXISTS on every statement (idempotent, safe to retry)
--   - No inbound FKs, so plain DROP TABLE succeeds without cascade
-- =============================================================================

-- Drop tables first (order: no particular constraint since all 3 are leaves)
DROP TABLE IF EXISTS "anonymization_requests";
DROP TABLE IF EXISTS "data_export_requests";
DROP TABLE IF EXISTS "user_consents";

-- Drop enums (only after the tables that used them are gone)
DROP TYPE IF EXISTS "anonymization_status_enum";
DROP TYPE IF EXISTS "data_export_status_enum";
DROP TYPE IF EXISTS "consent_type_enum";
