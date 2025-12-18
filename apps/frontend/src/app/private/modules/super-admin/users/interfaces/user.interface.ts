export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  state: UserState;
  last_login?: string;
  failed_login_attempts: number;
  locked_until?: string;
  email_verified: boolean;
  two_factor_enabled: boolean;
  onboarding_completed: boolean;
  organization_id: number;
  app?: 'ORG_ADMIN' | 'STORE_ADMIN' | 'STORE_ECOMMERCE' | 'VENDIX_LANDING';
  organizations?: {
    id: number;
    name: string;
  };
  user_roles?: UserRole[];
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: number;
  user_id: number;
  role_id: number;
  roles: {
    id: number;
    name: string;
    description: string;
    is_system_role: boolean;
    created_at: string;
    updated_at: string;
  };
}

export enum UserState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING_VERIFICATION = 'pending_verification',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
}

export interface CreateUserDto {
  app?: 'ORG_ADMIN' | 'STORE_ADMIN' | 'STORE_ECOMMERCE' | 'VENDIX_LANDING';
  organization_id: number;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  password: string;
  state?: UserState;
}

export interface UpdateUserDto {
  app?: 'ORG_ADMIN' | 'STORE_ADMIN' | 'STORE_ECOMMERCE' | 'VENDIX_LANDING';
  organization_id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  email?: string;
  password?: string;
  state?: UserState;
  last_login?: string;
  failed_login_attempts?: number;
  locked_until?: string;
}

export interface UserQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  state?: UserState;
  organization_id?: number;
}

export interface UsersDashboardDto {
  store_id?: string;
  search?: string;
  role?: string;
  page?: number;
  limit?: number;
  include_inactive?: boolean;
}

export interface UserStats {
  total_usuarios: number;
  activos: number;
  pendientes: number;
  con_2fa: number;
  inactivos: number;
  suspendidos: number;
  email_verificado: number;
  archivados: number;
}

export interface PaginatedUsersResponse {
  data: User[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}
