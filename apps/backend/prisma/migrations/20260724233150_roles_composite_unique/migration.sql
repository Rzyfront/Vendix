-- DATA IMPACT:
-- tabla: roles
-- operacion: drop index roles_name_key; create index roles_organization_id_name_key
-- filas afectadas: 0 (DDL puro; ningún INSERT/UPDATE/DELETE)
-- idempotente: SI (DROP ... IF EXISTS)
-- precondición: PostgreSQL 15+ (no requiere feature nueva, pero la migración
--               siguiente usa NULLS NOT DISTINCT que sí requiere 15+)

-- QUI-473: composite unique on (organization_id, name)
-- Replace global @unique on roles.name with a composite unique per organization.
-- System roles (is_system_role=true) keep organization_id NULL and remain unique
-- among themselves thanks to Postgres NULLS DISTINCT semantics on the unique index.

-- Drop global unique index on name
DROP INDEX IF EXISTS "roles_name_key";

-- Create composite unique index on (organization_id, name)
CREATE UNIQUE INDEX "roles_organization_id_name_key" ON "roles"("organization_id", "name");
