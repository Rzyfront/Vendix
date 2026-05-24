/**
 * Roles con visibilidad amplia que reciben merge automático de panel_ui
 * defaults al servir user_settings. Otros roles ven solo lo que el admin
 * curó explícitamente en su user_settings.config.panel_ui.
 *
 * Canónico contra apps/backend/prisma/seeds/permissions-roles.seed.ts.
 */
export const PRIVILEGED_ROLE_NAMES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'super_admin',
]);

type RoleLike =
  | string
  | { name?: string | null }
  | null
  | undefined;

/**
 * Devuelve true si la colección contiene al menos un rol privilegiado.
 * Tolerante a string[] o a estructuras tipo user_roles[].roles.name.
 */
export function hasPrivilegedRole(
  roles: ReadonlyArray<RoleLike> | null | undefined,
): boolean {
  if (!roles || roles.length === 0) return false;
  for (const r of roles) {
    const name = typeof r === 'string' ? r : r?.name;
    if (name && PRIVILEGED_ROLE_NAMES.has(name.toLowerCase())) {
      return true;
    }
  }
  return false;
}
