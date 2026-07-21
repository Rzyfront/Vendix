import { useAuthStore } from '@/core/store/auth.store';

/**
 * Permiso requerido para forzar un cambio de modo operativo (incluye downgrade).
 * Espejo del web `authFacade.hasPermission('organization:settings:operating_scope:write')`.
 */
export const OPERATING_SCOPE_WRITE_PERMISSION =
  'organization:settings:operating_scope:write';

/**
 * Devuelve `true` cuando el usuario actual tiene el permiso de escritura sobre
 * el modo operativo. Espejo del web `hasWritePermission` computed.
 *
 * Política: deny-until-proven.
 *   - Sin sesión → false.
 *   - Sin permisos cargados (`permissions` undefined o `[]`) → false.
 *   - Permisos cargados → true sólo si la permission explícita está presente.
 *
 * ⚠️ Estado actual del auth store mobile:
 * El campo `permissions: string[]` en `useAuthStore` está declarado pero no
 * se popula del login (el response de `/auth/login` no incluye `permissions`).
 * Esto significa que hasta que el backend exponga `permissions` en el
 * AuthResponse, `hasOperatingScopeWritePermission()` devolverá `false` y la
 * UI ocultará la acción de cambio. El backend sigue siendo la fuente de
 * verdad (controllers decorados con @Permissions() rechazan con 403), así
 * que no hay agujero de seguridad: el deny-by-default sólo bloquea UI
 * hasta que la fuente canónica esté disponible.
 *
 * Cuando el backend exponga `permissions` en el AuthResponse, este helper
 * empezará a devolver `true` para usuarios con el permiso sin cambios.
 */
export function hasOperatingScopeWritePermission(): boolean {
  const state = useAuthStore.getState();
  if (!state.isAuthenticated || !state.user) {
    return false;
  }
  const permissions = state.permissions;
  // Deny-by-default: sin permisos cargados, NO asumimos permiso.
  if (!permissions || permissions.length === 0) {
    return false;
  }
  return permissions.includes(OPERATING_SCOPE_WRITE_PERMISSION);
}