-- DATA IMPACT:
--   CONSTRAINT: drop unique constraint domain_settings_hostname_key (si existe)
--   El partial unique index domain_settings_hostname_active_uniq creado en la migración previa
--   (20260428004051_domain_provisioning_v2) cubre el caso de unicidad para domains no-terminales.
--   Tras esto: hostnames pueden duplicarse SOLO si todos están en estados terminales
--   (disabled, failed_*). Esto permite que un cliente reclame un hostname tras cool-down
--   o que se haga retry de un domain que falló validación.
-- DESTRUCTIVE: NONE — solo elimina constraint, los datos no se tocan.
-- IDEMPOTENT: SI — IF EXISTS guard tanto en constraint como en index.

ALTER TABLE "domain_settings" DROP CONSTRAINT IF EXISTS "domain_settings_hostname_key";

-- También considerar el index implícito (Postgres a veces los nombra distinto)
DROP INDEX IF EXISTS "domain_settings_hostname_key";
