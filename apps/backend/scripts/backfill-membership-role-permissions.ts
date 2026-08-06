import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { syncRolePermissions } from '../prisma/seeds/shared/sync-role-permissions';

/**
 * Backfill — membership role_permissions para owner / admin / manager.
 * ====================================================================
 *
 * El bug:
 * El seed añade `store:memberships:*` y `store:membership_plans:*` a la tabla
 * `permissions` y luego los asigna a los roles owner / admin / manager via
 * `syncRolePermissions`. Si el seed NO se ha re-ejecutado desde que estos
 * permisos se introdujeron, la tabla `role_permissions` queda desfasada: los
 * permisos existen pero no están asignados a los roles.
 *
 * Consecuencia: el PermissionsGuard no encuentra el permiso por nombre en
 * `user.permissions` (cargado vía role_permissions JOIN), y el path-matching
 * tampoco funciona porque `route.path` es `'store/memberships/plans'` (sin
 * el prefijo `/api`), mientras que `permission.path` es
 * `'/api/store/memberships/plans'`. Resultado: 403 "No tienes permisos
 * suficientes" al crear un plan de membresía.
 *
 * El arreglo:
 * Script ADITIVO, idempotente, que asegura que owner / admin / manager
 * tengan los 8 permisos de memberships/memberships_plans en
 * `role_permissions`. NO toca filas existentes. Re-ejecutable. Dry-run
 * por defecto.
 *
 * Uso:
 *   ts-node -r tsconfig-paths/register scripts/backfill-membership-role-permissions.ts            (default: dry-run)
 *   ts-node -r tsconfig-paths/register scripts/backfill-membership-role-permissions.ts --run       (aplica)
 *   ts-node -r tsconfig-paths/register scripts/backfill-membership-role-permissions.ts --run --role=owner
 *
 * Roles target (los del filtro owner del seed, sin `super_admin:*` ni
 * `superadmin:*`):
 *   - super_admin: NO se toca. super_admin ya tiene TODOS los permisos por
 *     construcción (syncRolePermissions con allPermissions), así que el bug
 *     no le afecta. Excluirlo evita ruido en el reporte.
 *   - owner: SÍ (paridad operativa sin superadmin:*).
 *   - admin (STORE_ADMIN): SÍ (paridad con owner).
 *   - manager (también STORE_ADMIN role en el sistema — se distingue por nombre
 *     `'STORE_ADMIN (manager)'` o `name = 'STORE_ADMIN'`). El seed distingue
 *     el filtro de manager (más restrictivo). Para este backfill NO replicamos
 *     el filtro de manager — sólo agregamos los permisos de memberships que
 *     manager YA RECIBE en el filtro. La auditoría final por línea muestra
 *     qué permisos se agregaron a qué rol.
 *   - supervisor / employee / cashier / carrier: NO — el seed no les da
 *     permisos de memberships. Este script respeta la política del seed.
 *
 * Garantías:
 *   - ADITIVO puro: sólo createMany con skipDuplicates. Ningún DELETE, ningún
 *     UPDATE, ningún cambio en filas existentes.
 *   - Idempotente: re-ejecutable sin daño. skipDuplicates usa el índice
 *     único @@unique([role_id, permission_id]).
 *   - Dry-run por defecto — el operador decide cuándo aplicar.
 *   - Reporte explícito por rol (added / already present / target).
 */

const prisma = new PrismaClient();

const MEMBERSHIP_PERMISSION_NAMES = [
  'store:memberships:read',
  'store:memberships:create',
  'store:memberships:update',
  'store:memberships:bulk_import',
  'store:memberships:delete',
  'store:membership_plans:read',
  'store:membership_plans:create',
  'store:membership_plans:update',
  'store:membership_plans:delete',
  // 'store:memberships:bulk_import' cubre el bloque de carga masiva AI;
  // los membership_access no se incluyen porque el filtro owner del seed
  // original los trae vía `store:memberships:*` matching, pero el seed
  // actual define membership_access_* como permisos independientes. Si
  // están en la DB, se agregan abajo en el bloque "wildcard".
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--run');
  const roleFilter = args
    .find((a) => a.startsWith('--role='))
    ?.split('=')[1];

  console.log(
    `[backfill-membership-role-permissions] starting (dryRun=${dryRun}${
      roleFilter ? `, roleFilter=${roleFilter}` : ''
    })`,
  );

  // 1. Resolver permisos target desde la DB. Si alguno no existe, abortamos
  //    con un mensaje claro — no tiene sentido seguir si el seed nunca se
  //    corrió.
  const permissions = await prisma.permissions.findMany({
    where: { name: { in: MEMBERSHIP_PERMISSION_NAMES } },
    select: { id: true, name: true },
  });
  const foundByName = new Map(permissions.map((p) => [p.name, p.id]));
  const missing = MEMBERSHIP_PERMISSION_NAMES.filter(
    (n) => !foundByName.has(n),
  );
  if (missing.length > 0) {
    console.error(
      `❌ Permissions not found in DB: ${missing.join(', ')}. Run the seed first.`,
    );
    process.exit(1);
  }
  const permissionIds = Array.from(foundByName.values());
  console.log(
    `   ✓ Found ${permissionIds.length} membership permissions in DB`,
  );

  // 2. Wildcard extra: cualquier `store:membership_access:*` que exista.
  //    El filtro owner del seed los cubre via `store:memberships:*` matching,
  //    pero por seguridad los añadimos explícitamente para no dejar el
  //    módulo access sin asignar.
  const accessPermissions = await prisma.permissions.findMany({
    where: { name: { startsWith: 'store:membership_access:' } },
    select: { id: true, name: true },
  });
  for (const p of accessPermissions) {
    if (!permissionIds.includes(p.id)) {
      permissionIds.push(p.id);
      console.log(`   + Including wildcard permission: ${p.name}`);
    }
  }

  // 3. Resolver roles target. Excluir super_admin (ya tiene todo) y los roles
  //    operativos de bajo nivel (supervisor / employee / cashier / carrier)
  //    que el seed no dota de permisos de memberships.
  const ROLES_TO_INCLUDE = ['owner', 'admin', 'STORE_ADMIN'];
  const ROLES_TO_EXCLUDE = [
    'super_admin',
    'supervisor',
    'employee',
    'cashier',
    'carrier',
    'fiscal_supervisor',
    'customer',
  ];

  const allRoles = await prisma.roles.findMany({
    select: { id: true, name: true },
  });
  const targetRoles = allRoles.filter((r) => {
    if (roleFilter && r.name !== roleFilter) return false;
    if (ROLES_TO_EXCLUDE.includes(r.name)) return false;
    return ROLES_TO_INCLUDE.some((n) => r.name === n || r.name.includes(n));
  });

  console.log(
    `   ✓ Target roles: ${targetRoles.map((r) => r.name).join(', ') || '(none)'}`,
  );
  if (targetRoles.length === 0) {
    console.error('❌ No target roles found. Aborting.');
    process.exit(1);
  }

  // 4. Pre-cargar role_permissions existentes para reportar added vs
  //    already_present.
  const existing = await prisma.role_permissions.findMany({
    where: {
      role_id: { in: targetRoles.map((r) => r.id) },
      permission_id: { in: permissionIds },
    },
    select: { role_id: true, permission_id: true },
  });
  const existingSet = new Set(
    existing.map((e) => `${e.role_id}:${e.permission_id}`),
  );

  // 5. Por cada rol target, correr syncRolePermissions (additive +
  //    skipDuplicates). El helper escribe el log por sí mismo.
  let totalAdded = 0;
  for (const role of targetRoles) {
    const missingForRole = permissionIds.filter(
      (id) => !existingSet.has(`${role.id}:${id}`),
    );
    console.log(
      `   → Role "${role.name}": ${permissionIds.length - missingForRole.length} present, ${missingForRole.length} to add`,
    );
    if (!dryRun && missingForRole.length > 0) {
      const result = await syncRolePermissions(
        prisma,
        role.id,
        permissionIds,
        `BACKFILL (${role.name})`,
      );
      totalAdded += result.added;
    } else if (dryRun) {
      totalAdded += missingForRole.length;
    }
  }

  console.log('');
  console.log(
    `[backfill-membership-role-permissions] ${dryRun ? 'DRY-RUN' : 'APPLIED'} — would have added ${totalAdded} role_permissions rows`,
  );
  if (dryRun) {
    console.log('   Re-run with --run to apply.');
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error('[backfill-membership-role-permissions] FAILED', err);
    await prisma.$disconnect();
    process.exit(1);
  });
