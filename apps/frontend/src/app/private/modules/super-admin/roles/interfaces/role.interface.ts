import type { RoleScope } from '../../../../../shared/constants/role-scope.constant';

export type { RoleScope };

/**
 * QUI-72 — El backend de superadmin publica `scope` DERIVADO junto a las FKs
 * (`organization_id` / `store_id`) y los nombres del tenant dueño. El frontend
 * NO recalcula el alcance: si lo derivara por su cuenta, la etiqueta pintada
 * podría discrepar del filtro y de la autorización que aplica el backend.
 */

/** Permiso tal como lo aplana `mapToResponse` del backend (objeto, no string). */
export interface RolePermissionRef {
  id: number;
  name: string;
  description?: string | null;
}

/** Fila de `user_roles` embebida en el detalle del rol. */
export interface RoleUserRoleRow {
  id: number;
  user_id: number;
  role_id: number;
  store_id: number | null;
  users?: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  };
  stores?: { id: number; name: string } | null;
}

export interface Role {
  id: number;
  name: string;
  description: string | null;
  is_system_role: boolean;
  created_at: string;
  updated_at: string;
  /** Alcance derivado por el backend. Fuente única de la etiqueta y del filtro. */
  scope: RoleScope;
  organization_id: number | null;
  store_id: number | null;
  organization_name: string | null;
  store_name: string | null;
  permissions?: RolePermissionRef[];
  user_roles?: RoleUserRoleRow[];
  _count?: {
    user_roles: number;
    role_permissions?: number;
  };
}

export interface Permission {
  id: number;
  name: string;
  description: string;
  path: string;
  method: HttpMethod;
  status: PermissionStatus;
  created_at: string;
  updated_at: string;
  _count?: {
    role_permissions: number;
  };
}

export enum PermissionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DEPRECATED = 'deprecated',
}

export interface CreateRoleDto {
  name: string;
  description: string;
  is_system_role?: boolean;
  /** `null` = sin dueño (rol de sistema). */
  organization_id?: number | null;
  /** Exige `organization_id`; la tienda debe pertenecer a esa organización. */
  store_id?: number | null;
}

export interface UpdateRoleDto {
  name?: string;
  description?: string;
  is_system_role?: boolean;
  /**
   * `undefined` = campo ausente (conserva el valor actual); `null` = desvincular
   * explícitamente. El backend distingue ambos, así que el frontend también.
   */
  organization_id?: number | null;
  store_id?: number | null;
}

export interface CreatePermissionDto {
  name: string;
  description: string;
  path: string;
  method: HttpMethod;
  status?: PermissionStatus;
}

export interface UpdatePermissionDto {
  name?: string;
  description?: string;
  path?: string;
  method?: HttpMethod;
  status?: PermissionStatus;
}

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
  OPTIONS = 'OPTIONS',
  HEAD = 'HEAD',
}

export interface RoleQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  is_system_role?: boolean;
  /** Filtro por alcance derivado (inversa exacta de `deriveRoleScope`). */
  scope?: RoleScope;
  organization_id?: number;
  store_id?: number;
}

export interface PermissionQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  method?: HttpMethod;
  status?: PermissionStatus;
}

export interface AssignPermissionsDto {
  permission_ids: number[];
}

/**
 * Alcance de UNA asignación rol↔usuario. Idéntico en las dos direcciones
 * (rol→usuario y usuario→rol): ausente o `null` = org-wide.
 */
export interface RoleAssignmentScope {
  store_id?: number | null;
}

/** Fila de `GET /superadmin/roles/:id/users`. */
export interface RoleUserAssignment {
  assignment_id: number;
  store_id: number | null;
  store_name: string | null;
  user: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    state: string;
    organization_id: number | null;
  };
}

/** Fila de `GET /superadmin/users/:userId/roles`. */
export interface UserRoleAssignment {
  assignment_id: number;
  store_id: number | null;
  store_name: string | null;
  role: {
    id: number;
    name: string;
    description: string | null;
    is_system_role: boolean;
    organization_id: number | null;
    store_id: number | null;
    scope: RoleScope;
  } | null;
}

/** Respuesta de `POST .../users/:userId` y `POST .../roles/:roleId`. */
export interface RoleAssignmentResult {
  message?: string;
  assignment_id?: number;
  user_id: number;
  role_id: number;
  store_id: number | null;
  scope?: RoleScope;
}

/** Respuesta de los `DELETE` de asignación. */
export interface RoleAssignmentRemoval {
  message?: string;
  user_id: number;
  role_id: number;
  store_id: number | null;
  removed: boolean;
}

/** Opción mínima de organización/tienda para filtros y pickers. */
export interface TenantOption {
  id: number;
  name: string;
}

/** Desglose por alcance derivado que publica el dashboard. */
export interface RoleScopeBreakdown {
  system: number;
  organization: number;
  store: number;
}

export interface RoleStats {
  totalRoles: number;
  /** Flag CRUDO `is_system_role`. No confundir con `rolesByScope.system`. */
  systemRoles: number;
  customRoles: number;
  totalPermissions: number;
  rolesByScope: RoleScopeBreakdown;
}

export interface PaginatedRolesResponse {
  data: Role[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface PaginatedPermissionsResponse {
  data: Permission[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}
