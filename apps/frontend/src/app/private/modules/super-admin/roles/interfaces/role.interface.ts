export interface Role {
  id: number;
  name: string;
  description: string;
  is_system_role: boolean;
  created_at: string;
  updated_at: string;
  permissions?: string[];
  _count?: {
    user_roles: number;
  };
}

export interface Permission {
  id: number;
  name: string;
  description: string;
  path: string;
  method: string;
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
}

export interface UpdateRoleDto {
  name?: string;
  description?: string;
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

export interface AssignRoleToUserDto {
  user_id: number;
  role_id: number;
}

export interface RemoveRoleFromUserDto {
  user_id: number;
  role_id: number;
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

export interface UserRole {
  id: number;
  user_id: number;
  role_id: number;
  roles: Role;
}

export interface UserPermissionsResponse {
  permissions: Permission[];
  roles: Role[];
}
