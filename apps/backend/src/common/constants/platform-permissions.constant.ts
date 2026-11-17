/**
 * Vendix Platform · permisos de la superficie interna de Vendix
 * (odd/tasks/vendix-platform-crm-enlace.md, candado 3).
 *
 * Todo permiso `platform:*` es de SISTEMA (`is_system_permission = true`) y
 * pertenece solo a super_admin y al rol "Comercial Vendix" de la org
 * plataforma. Ningún tenant lo hereda ni lo puede asignar:
 *   - `organization/roles` rechaza asignarlo (ORG_PERM_001).
 *   - el rol ORG_ADMIN que crea el onboarding lo excluye
 *     (`createDefaultOrgAdminRole`), aunque reciba los demás de sistema.
 *   - el seed lo excluye de owner/admin/manager (`isPlatformPermission` en
 *     `prisma/seeds/permissions-roles.seed.ts`, copia local porque la imagen de
 *     producción no trae `src/` salvo archivos puntuales).
 */
export const PLATFORM_PERMISSION_PREFIX = 'platform:';

export const PLATFORM_CRM_LINK_PERMISSIONS = {
  MANAGE: 'platform:crm_link:manage',
  READ: 'platform:crm_link:read',
} as const;

export function isPlatformPermissionName(name: string): boolean {
  return name.startsWith(PLATFORM_PERMISSION_PREFIX);
}
