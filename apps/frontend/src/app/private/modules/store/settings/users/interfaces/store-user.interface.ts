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

export interface Role {
  id: number;
  name: string;
  description?: string;
  is_system_role?: boolean;
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
