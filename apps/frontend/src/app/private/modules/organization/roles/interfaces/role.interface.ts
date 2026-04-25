export interface Role {
  id: number;
  name: string;
  description?: string;
  system_role: boolean;
  created_at?: string;
  updated_at?: string;
  permissions?: string[];
  user_roles?: UserRoleInfo[];
  _count?: {
    user_roles: number;
  };
}

export interface UserRoleInfo {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  state: string;
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
  system_role?: boolean;
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
}

export interface RemoveRoleFromUserDto {
  user_id: number;
  role_id: number;
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
