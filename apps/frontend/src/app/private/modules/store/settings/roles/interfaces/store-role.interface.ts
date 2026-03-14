export interface StoreRole {
  id: number;
  name: string;
  description?: string;
  system_role: boolean;
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
  custom_roles: number;
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
