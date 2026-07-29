import { RoleScope } from '../../../../../shared/constants/role-scope.constant';

export interface Role {
  id: number;
  name: string;
  description?: string;
  system_role: boolean;
  /** NULL en roles de sistema. */
  organization_id?: number | null;
  /**
   * QUI-72 — alcance derivado por el backend (`deriveRoleScope`).
   *
   * NO se recalcula en el cliente: la matriz vive en el backend y el
   * contrato compartido (`shared/constants/role-scope.constant.ts`) sólo la
   * etiqueta. Derivarlo aquí a partir de `organization_id`/`store_id` haría
   * que las tres pantallas de roles discreparan en cuanto cambie una regla.
   */
  scope: RoleScope;
  /** Tienda dueña del rol cuando `scope === 'store'`; NULL en los demás. */
  store_id: number | null;
  store_name: string | null;
  created_at?: string;
  updated_at?: string;
  permissions?: string[];
  /**
   * Sólo lo trae `GET /organization/roles/:id` (el listado sólo trae
   * `_count`). Son filas de `user_roles`, no usuarios planos.
   */
  user_roles?: RoleUserAssignment[];
  _count?: {
    user_roles: number;
  };
}

/** Usuario embebido en una asignación. */
export interface UserRoleInfo {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  state: string;
}

/**
 * Fila de `user_roles` tal y como la devuelve `GET /organization/roles/:id`
 * (dirección rol → usuario).
 *
 * `store_id === null` significa "la asignación vale en toda la organización".
 */
export interface RoleUserAssignment {
  id: number;
  user_id: number;
  role_id: number;
  store_id: number | null;
  stores?: { id: number; name: string } | null;
  users?: UserRoleInfo | null;
  created_at?: string;
}

/** Rol embebido en una asignación usuario → rol. */
export interface AssignedRole {
  id: number;
  name: string;
  description?: string | null;
  is_system_role: boolean;
  organization_id: number | null;
  store_id: number | null;
  scope: RoleScope;
}

/**
 * QUI-72 — forma NUEVA de `GET /organization/users/:userId/roles` y de
 * `GET /organization/roles/user/:userId/roles`.
 *
 * Antes devolvían filas crudas de `user_roles`; ahora devuelven la asignación
 * con su tienda resuelta. Sin `store_id` la lista es ambigua: "Cajero" no dice
 * si aplica en toda la organización o sólo en una tienda.
 */
export interface UserRoleAssignment {
  assignment_id: number;
  store_id: number | null;
  store_name: string | null;
  role: AssignedRole | null;
}

export interface Permission {
  id: number;
  name: string;
  description?: string;
  path: string;
  method: string;
  status: PermissionStatus;
  created_at?: string;
  updated_at?: string;
  is_system_permission?: boolean;
}

export enum PermissionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DEPRECATED = 'deprecated',
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

export interface CreateRoleDto {
  name: string;
  description?: string;
  /**
   * @deprecated El nivel organización lo IGNORA (sólo superadmin crea roles de
   * sistema). Se conserva declarado porque el DTO del backend aún lo acepta.
   */
  system_role?: boolean;
  /**
   * QUI-72 — alcance TIENDA opcional. Omitido → rol de alcance organización.
   * Con valor, el backend valida que la tienda sea de la organización
   * (403 `ROLE_ASSIGN_007` si no).
   */
  store_id?: number | null;
}

export interface UpdateRoleDto {
  name?: string;
  description?: string;
}

export interface AssignPermissionsDto {
  permission_ids: number[];
}

export interface RoleQueryDto {
  page?: number;
  limit?: number;
  search?: string;
}

export interface RoleStats {
  total_roles: number;
  system_roles: number;
  custom_roles: number;
  total_permissions: number;
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

export interface AssignRoleToUserDto {
  user_id: number;
  role_id: number;
  /** NULL/omitido = asignación válida en toda la organización. */
  store_id?: number | null;
}

export interface RemoveRoleFromUserDto {
  user_id: number;
  role_id: number;
  /**
   * NULL/omitido remueve la asignación org-wide, NO las de tienda: desde que
   * el unique es (user_id, role_id, store_id) son filas distintas.
   */
  store_id?: number | null;
}

/** Respuesta de `POST /organization/roles/assign-to-user`. */
export interface AssignRoleToUserResponse {
  id: number;
  assignment_id: number;
  user_id: number;
  role_id: number;
  store_id: number | null;
  store_name: string | null;
  scope: RoleScope;
  users?: UserRoleInfo | null;
  roles?: Partial<Role> | null;
}

/** Respuesta de `POST /organization/roles/remove-from-user`. */
export interface RemoveRoleFromUserResponse {
  message: string;
  user_id: number;
  role_id: number;
  store_id: number | null;
}

export interface RolePermissionsResponse {
  role_id: number;
  permission_ids: number[];
  total_permissions: number;
}

export interface PermissionGroupedByDomain {
  domain: string;
  label: string;
  permissions: Permission[];
}
