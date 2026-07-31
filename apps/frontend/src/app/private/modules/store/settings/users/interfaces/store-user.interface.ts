export interface StoreUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  username?: string;
  phone?: string;
  state: StoreUserState;
  last_login?: string;
  created_at: string;
  store_user_id?: number;
  avatar_url?: string;
}

import { RoleScope } from '../../../../../../shared/constants/role-scope.constant';

/**
 * QUI-72 — Rol tal como lo ven las dos direcciones del nivel tienda.
 *
 * `scope` viene derivado del backend tanto en `GET /store/roles` (catálogo del
 * selector) como en `GET /store/users/management/:id` (roles del usuario).
 *
 * `assignment_store_id` SÓLO aparece en el detalle del usuario y es la pieza
 * que decide la UI: `null` ⇒ asignación org-wide HEREDADA, que la tienda no
 * puede quitar (el backend la conserva al guardar) y que por tanto no debe
 * poder desmarcarse ni viajar en el payload de `role_ids`.
 */
export interface Role {
  id: number;
  name: string;
  description?: string;
  is_system_role?: boolean;
  scope: RoleScope;
  organization_id?: number | null;
  store_id?: number | null;
  assignment_store_id?: number | null;
}

export interface StoreUserDetail extends StoreUser {
  roles: Role[];
  panel_ui: Record<string, Record<string, boolean>>;
  email_verified?: boolean;
  /**
   * App the user lands on: `STORE_ADMIN` (panel de tienda) o `STORE_DELIVERY`
   * (Repartos). Se asigna MANUALMENTE por un admin vía el selector; asignar el
   * rol carrier ya no lo mueve solo. Solo puede ser `STORE_DELIVERY` si el
   * usuario tiene el rol carrier (contrato backend).
   */
  app_type?: string;
}

export enum StoreUserState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING_VERIFICATION = 'pending_verification',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
}

export interface StoreUserStats {
  total: number;
  activos: number;
  inactivos: number;
  pendientes: number;
}

export interface CreateStoreUserDto {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  username?: string;
  /**
   * QUI-581 — Rol operativo con el que nace el usuario. Opcional: el backend
   * (`CreateStoreUserDto.role`) ya lo aceptaba y validaba contra
   * `ASSIGNABLE_STORE_USER_ROLES`, pero el modal nunca lo enviaba, así que todo
   * usuario nacía `employee` y sólo podía corregirse en el modal de edición.
   */
  role?: string;
}

export interface UpdateStoreUserDto {
  first_name?: string;
  last_name?: string;
  email?: string;
  username?: string;
  phone?: string;
}

export interface UpdateUserRolesDto {
  role_ids: number[];
}

export interface UpdateUserPanelUIDto {
  panel_ui: Record<string, Record<string, boolean>>;
}

export interface StoreUserQuery {
  page?: number;
  limit?: number;
  search?: string;
  state?: string;
}

export interface PaginatedStoreUsersResponse {
  data: StoreUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}
