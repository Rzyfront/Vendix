-- QUI-730b (FIX P0) — renombrar roles de sistema `mesero` → `waiter` y
-- `cocina` → `kitchen`. Corregido el criterio de WHERE: pasa de `WHERE id IN (32, 33)`
-- (portable-bug: el `id` es autoincrement por entorno y no es estable entre
-- DB local / staging / prod) a `WHERE name=old AND organization_id IS NULL
-- AND store_id IS NULL` (estable e identifica roles de sistema sin chocar con
-- `mesero`/`cocina` de organización como el de prod id=67, org=82, store=105
-- que NO debe ser renombrado — el requisito del usuario es sobre los roles
-- del sistema, no de cada comercio que reuse el nombre).
--
-- DATA IMPACT:
--   Tables affected: roles
--   Expected row changes:
--     - En DB local (seed actual): 2 filas (id=32, id=33, ambas con
--       organization_id=NULL, store_id=NULL — son los roles de sistema).
--     - En prod al momento del fix: 0 filas (medido por fixarabe: `mesero`
--       existe solo como rol de organización id=67, org=82, store=105; los
--       roles de sistema `mesero`/`cocina` no están sembrados en prod).
--       Cuando se siembren, esta migración los renombrará — la próxima
--       corrida del seed los crea ya como waiter/kitchen directamente, pero
--       esta migración cubre cualquier DB que tenga los roles viejos.
--   Destructive operations: none (UPDATE no destructivo).
--   FK/cascade risk: roles.name se referencia desde role_permissions (vía
--     role_id, no name — sin riesgo), user_roles (idem), tests/docs. Las
--     pruebas y código que comparan el literal 'mesero'/'cocina' se
--     actualizan EN EL MISMO COMMIT que esta migración.
--   Idempotency: guard `WHERE name=old_name AND organization_id IS NULL AND
--     store_id IS NULL` para que re-aplicar sea no-op (la fila ya no matchea).
--   Approval: autorizado por el usuario para el cierre de QUI-730
--     (per-fixarabe 2026-08-31). Corrección P0 reportada por fixarabe el
--     mismo día tras auditar la versión inicial con `WHERE id IN (32, 33)`.
--
-- Por qué el doble scope (organization_id IS NULL AND store_id IS NULL):
--   El índice único compuesto
--     roles_organization_id_store_id_name_key (organization_id, store_id, name)
--     con NULLS NOT DISTINCT aplica a roles de sistema SIN org/store Y a
--     roles de organización/tienda. El requisito del usuario dice «los
--     roles del sistema deben llevar nombres en inglés» — eso es
--     (organization_id=NULL, store_id=NULL), no (organization_id=X, store_id=NULL)
--     que sería el rol de una organización. El `WHERE` debe excluir el rol
--     id=67 de prod (org=82, store=105) que reutiliza el nombre.
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

-- Renombrar roles de sistema `mesero` → `waiter`. Criterio estable:
-- organization_id IS NULL (rol de sistema, no de una org) AND store_id IS NULL
-- (rol de sistema, no de una tienda). Esto cubre cualquier DB donde exista
-- la fila (local, staging, prod futuro sembrado) y la deja intacta en prod
-- si solo existe el id=67 con org=82/store=105 (rol de organización).
UPDATE "roles"
SET "name" = 'waiter', "updated_at" = NOW()
WHERE "name" = 'mesero'
  AND "organization_id" IS NULL
  AND "store_id" IS NULL;

-- Renombrar roles de sistema `cocina` → `kitchen` con el mismo criterio.
UPDATE "roles"
SET "name" = 'kitchen', "updated_at" = NOW()
WHERE "name" = 'cocina'
  AND "organization_id" IS NULL
  AND "store_id" IS NULL;

COMMIT;