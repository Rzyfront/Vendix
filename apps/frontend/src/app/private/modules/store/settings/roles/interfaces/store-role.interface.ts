import { RoleScope } from '../../../../../../shared/constants/role-scope.constant';

/**
 * QUI-72 — Contrato REAL de `GET /store/roles` (`transformRole` en
 * `apps/backend/src/domains/store/roles/store-roles.service.ts`).
 *
 * OJO con `is_system_role`: la interfaz anterior declaraba `system_role`, un
 * campo que el backend NUNCA ha devuelto. Al ser `undefined` en runtime, el
 * badge "Sistema/Personalizado" y los `show:` de las acciones evaluaban
 * siempre la rama de rol personalizado. Se corrige al nombre real y el badge
 * pasa a leer `scope`, que es el dato con el que el backend autoriza.
 */
export interface StoreRole {
  id: number;
  name: string;
  description?: string;
  is_system_role: boolean;
  organization_id: number | null;
  store_id: number | null;
  /** Alcance derivado por el backend. NO se recalcula en el cliente. */
  scope: RoleScope;
  created_at?: string;
  updated_at?: string;
  permissions: string[];
  _count?: {
    user_roles: number;
  };
}

export interface StorePermission {
  id: number;
  name: string;
  description?: string;
  module?: string;
  status: string;
}

export interface StoreRoleStats {
  total_roles: number;
  system_roles: number;
  /** Compatibilidad: `organization_roles + store_roles`. */
  custom_roles: number;
  organization_roles: number;
  store_roles: number;
  total_store_permissions: number;
}

export interface CreateStoreRoleDto {
  name: string;
  description?: string;
}

export interface UpdateStoreRoleDto {
  name?: string;
  description?: string;
}

export interface RolePermissionsResponse {
  role_id: number;
  permission_ids: number[];
  total_permissions: number;
}

// ── Rol → Usuarios (QUI-72) ────────────────────────────────────────────

/** Usuario embebido en una asignación de rol (`GET /store/roles/:id/users`). */
export interface StoreRoleAssignmentUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  state: string;
  organization_id: number | null;
}

/**
 * Fila de `GET /store/roles/:id/users`.
 *
 * `store_id === null` ⇒ asignación org-wide HEREDADA: el nivel tienda la ve
 * pero no puede quitarla (el backend responde 404 `ROLE_ASSIGN_004` porque
 * busca la asignación en la tienda del contexto).
 */
export interface StoreRoleUserAssignment {
  assignment_id: number;
  store_id: number | null;
  store_name: string | null;
  user: StoreRoleAssignmentUser;
}

/** Respuesta de `POST /store/roles/:id/users/:userId`. */
export interface AssignRoleToUserResult {
  assignment_id: number;
  user_id: number;
  role_id: number;
  store_id: number | null;
  scope: RoleScope;
}

/** Respuesta de `DELETE /store/roles/:id/users/:userId`. */
export interface RemoveRoleFromUserResult {
  user_id: number;
  role_id: number;
  store_id: number | null;
  removed: boolean;
}
