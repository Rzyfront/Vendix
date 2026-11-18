import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';
import { syncRolePermissions } from './shared/sync-role-permissions';

/**
 * Vendix Platform · rol "Comercial Vendix" (odd/tasks/vendix-platform-crm-enlace.md,
 * decisión D4). Equivalente idempotente de los pasos 6-7 de la migración
 * `20261204090000_platform_crm_links`, para bases que se arman con el seed.
 *
 * - Rol de ORGANIZACIÓN (no de sistema) de la org `is_platform`, org-wide
 *   (`store_id = NULL`). Solo porta los permisos `platform:crm_link:*`; el resto
 *   del CRM lo da el rol operativo que la persona ya tenga en la tienda.
 * - Sin org plataforma (base nueva antes de `vendix-platform-org`) no hace nada.
 * - Aditivo: nunca revoca ni renombra.
 *
 * Los nombres de permiso están duplicados a propósito respecto de
 * `src/common/constants/platform-permissions.constant.ts`: la imagen de
 * producción corre los seeds con tsx y no trae `src/` (ver Dockerfile).
 */
export const PLATFORM_CRM_ROLE_NAME = 'Comercial Vendix';
export const PLATFORM_CRM_ROLE_PERMISSIONS = [
  'platform:crm_link:manage',
  'platform:crm_link:read',
] as const;

export interface SeedPlatformCrmRoleResult {
  role_id: number | null;
  role_created: boolean;
  permissions_added: number;
}

export async function seedPlatformCrmRole(
  prisma?: PrismaClient,
): Promise<SeedPlatformCrmRoleResult> {
  const client = prisma || getPrismaClient();

  const platformOrg = await client.organizations.findFirst({
    where: { is_platform: true },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (!platformOrg) {
    console.log('   ⏭  Sin organización is_platform: rol Comercial Vendix omitido');
    return { role_id: null, role_created: false, permissions_added: 0 };
  }

  let role = await client.roles.findFirst({
    where: {
      name: PLATFORM_CRM_ROLE_NAME,
      organization_id: platformOrg.id,
      store_id: null,
    },
    select: { id: true },
  });
  let role_created = false;
  if (!role) {
    role = await client.roles.create({
      data: {
        name: PLATFORM_CRM_ROLE_NAME,
        description:
          'Equipo comercial de Vendix: enlaza prospectos del CRM con organizaciones cliente',
        is_system_role: false,
        organization_id: platformOrg.id,
        store_id: null,
      },
      select: { id: true },
    });
    role_created = true;
  }

  const permissions = await client.permissions.findMany({
    where: { name: { in: [...PLATFORM_CRM_ROLE_PERMISSIONS] } },
    select: { id: true },
  });
  const sync = await syncRolePermissions(
    client,
    role.id,
    permissions.map((p) => p.id),
    PLATFORM_CRM_ROLE_NAME,
  );

  return {
    role_id: role.id,
    role_created,
    permissions_added: sync.added,
  };
}
