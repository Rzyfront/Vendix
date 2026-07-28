/**
 * QUI-72 — Alcance de roles, contrato compartido del frontend.
 *
 * El backend devuelve `scope` ya derivado en cada fila de rol (no se recalcula
 * en el cliente: derivarlo aquí a partir de `organization_id` / `store_id`
 * duplicaría la matriz y las tres pantallas terminarían discrepando).
 *
 * Los tres módulos de roles — super-admin, organization y store/settings —
 * consumen estas constantes para que el badge, el filtro y el tooltip de
 * sólo-lectura digan exactamente lo mismo en los tres niveles.
 */

export type RoleScope = 'system' | 'organization' | 'store';

/** Nivel desde el que se está viendo la pantalla de roles. */
export type RoleActorLevel = 'superadmin' | 'organization' | 'store';

export const ROLE_SCOPE_LABELS: Record<RoleScope, string> = {
  system: 'Sistema',
  organization: 'Organización',
  store: 'Tienda',
};

/**
 * Colores del badge de alcance.
 *
 * DEBEN ser hex de 7 caracteres: `item-list`/`table` derivan el fondo y el
 * borde concatenando alfa (`${color}26`, `${color}40`), así que una clase de
 * Tailwind o un hex de 4 caracteres rompe el cálculo en silencio.
 */
export const ROLE_SCOPE_COLOR_MAP: Record<RoleScope, string> = {
  system: '#6366F1',
  organization: '#0EA5E9',
  store: '#10B981',
};

export const ROLE_SCOPE_ICONS: Record<RoleScope, string> = {
  system: 'shield-check',
  organization: 'building-2',
  store: 'store',
};

/** Opciones del filtro por alcance del listado (idénticas en los 3 niveles). */
export const ROLE_SCOPE_FILTER_OPTIONS: ReadonlyArray<{
  value: RoleScope;
  label: string;
}> = [
  { value: 'system', label: ROLE_SCOPE_LABELS.system },
  { value: 'organization', label: ROLE_SCOPE_LABELS.organization },
  { value: 'store', label: ROLE_SCOPE_LABELS.store },
];

export function getRoleScopeLabel(scope: RoleScope | null | undefined): string {
  return scope ? ROLE_SCOPE_LABELS[scope] : '—';
}

/**
 * Matriz de edición, espejo EXACTO de `canEditRole` en
 * `apps/backend/src/common/utils/role-scope.util.ts`.
 *
 * Sirve para ocultar acciones, NO para autorizar: la autorización real vive en
 * el backend y responde 403 tipado. Si esta función y el backend discrepan, el
 * backend gana — y eso es un bug de esta constante, no del backend.
 */
export function canEditRoleScope(
  scope: RoleScope | null | undefined,
  level: RoleActorLevel,
): boolean {
  if (!scope) return false;
  if (level === 'superadmin') return true;
  if (scope === 'system') return false;
  if (level === 'organization') return true;
  return scope === 'store';
}

/** Texto del tooltip que explica por qué un rol no se puede editar aquí. */
export function getRoleReadOnlyReason(
  scope: RoleScope | null | undefined,
  level: RoleActorLevel,
): string | null {
  if (canEditRoleScope(scope, level)) return null;
  if (scope === 'system') {
    return 'Rol de sistema: sólo el administrador de la plataforma puede modificarlo.';
  }
  if (scope === 'organization' && level === 'store') {
    return 'Rol heredado de la organización: se administra desde el panel de la organización.';
  }
  return 'No tienes permisos para modificar este rol desde este nivel.';
}
