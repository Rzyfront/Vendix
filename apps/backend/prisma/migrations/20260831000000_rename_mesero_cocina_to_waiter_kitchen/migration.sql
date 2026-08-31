-- QUI-730b — renombrar roles de sistema `mesero` → `waiter` y `cocina` → `kitchen`.
--
-- DATA IMPACT:
--   Tables affected: roles
--   Expected row changes: 2 filas en `roles` (id=32, id=33)
--   Destructive operations: none (UPDATE no destructivo)
--   FK/cascade risk: roles.name se referencia desde role_permissions.user_role (?), user_roles.user_role
--     y tests/docs. Las pruebas y código que comparan el literal 'mesero'/'cocina' se
--     actualizan EN EL MISMO COMMIT que esta migración (ver lista de archivos tocados).
--   Idempotency: guard con WHERE name=old_name para que re-aplicar sea no-op.
--   Approval: autorizado por el usuario para el cierre de QUI-730 (per-fixarabe 2026-08-31).
--
-- Migración NO destructiva: el índice único compuesto
--   roles_organization_id_store_id_name_key (organization_id, store_id, name)
--   con NULLS NOT DISTINCT permite que coexistan filas con name distinto, pero el
--   cambio de name NO inserta fila nueva — actualiza la misma fila (id estable).
--   Sin chocar con el índice.
--
-- ADR-10 (CRÍTICO): los 6 sitios de código que comparan el literal 'cocina'
-- para el strip de dinero se actualizan EN EL MISMO COMMIT:
--   - apps/backend/src/domains/store/products/products.service.ts:1439
--   - apps/backend/src/domains/store/recipes/recipes.service.ts:146
--   - apps/backend/src/common/utils/role-scope.util.ts:91, 92, 101, 102
--   - apps/backend/prisma/seeds/permissions-roles.seed.ts (literales de creación)
--   - apps/backend/prisma/seeds/restaurant-e2e.seed.ts:408, 411, 415, 535, 543
--   - apps/backend/src/domains/organization/roles/roles.service.spec.ts:445, 459
--   - apps/backend/src/domains/auth/README-permisos-por-rol.md:215, 223
-- Si esta migración se aplica SIN actualizar esos sitios, cocina/kitchen empieza
-- a ver precios y costos en KDS — falla en verde.

BEGIN;

-- Renombrar `mesero` → `waiter` (id=32, system role, organization_id=NULL, store_id=NULL)
UPDATE "roles"
SET "name" = 'waiter', "updated_at" = NOW()
WHERE "id" = 32 AND "name" = 'mesero';

-- Renombrar `cocina` → `kitchen` (id=33)
UPDATE "roles"
SET "name" = 'kitchen', "updated_at" = NOW()
WHERE "id" = 33 AND "name" = 'cocina';

COMMIT;
