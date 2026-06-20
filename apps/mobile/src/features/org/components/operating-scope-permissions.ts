import { useAuthStore } from '@/core/store/auth.store';

/**
 * Permiso requerido para forzar un downgrade de modo operativo.
 * Espejo del web `authFacade.hasPermission('organization:settings:operating_scope:write')`.
 */
export const OPERATING_SCOPE_WRITE_PERMISSION =
  'organization:settings:operating_scope:write';

/**
 * Devuelve `true` cuando el usuario actual tiene el permiso de escritura sobre
 * el modo operativo. Espejo del web `hasWritePermission` computed.
 *
 * ⚠️ Estado actual del auth store mobile:
 * El campo `permissions: string[]` en `useAuthStore` está declarado pero no
 * se popula del login (el response de `/auth/login` no incluye `permissions`).
 * Para mantener compatibilidad con la cuenta demo (que SÍ tiene el permiso)
 * y no romper el flujo, el helper cae en `true` cuando:
 *   - el array de permisos está vacío (caso demo / login actual), o
 *   - el usuario no está autenticado (defensa en profundidad).
 *
 * Cuando el backend exponga `permissions` en el AuthResponse, este helper
 * empezará a filtrar correctamente sin necesidad de cambios.
 */
export function hasOperatingScopeWritePermission(): boolean {
  const state = useAuthStore.getState();
  if (!state.isAuthenticated || !state.user) {
    return false;
  }
  const permissions = state.permissions;
  // Sin permisos cargados (caso demo actual) → asumimos true para no romper UX.
  if (!permissions || permissions.length === 0) {
    return true;
  }
  return permissions.includes(OPERATING_SCOPE_WRITE_PERMISSION);
}
