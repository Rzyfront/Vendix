export interface AuditLog {
  id: number;
  user_id: number;
  action: AuditAction;
  resource: AuditResource;
  resource_id: number | null;
  old_values: Record<string, any> | null;
  new_values: Record<string, any> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  organization_id: number | null;
  store_id: number | null;
  users: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    organization_id: number;
  } | null;
  stores: {
    id: number;
    name: string;
    organization_id: number;
  } | null;
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  READ = 'READ',
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
}

export enum AuditResource {
  USERS = 'users',
  ORGANIZATIONS = 'organizations',
  STORES = 'stores',
  ROLES = 'roles',
  PERMISSIONS = 'permissions',
  PRODUCTS = 'products',
  ORDERS = 'orders',
  CATEGORIES = 'categories',
}

export interface AuditStats {
  total_logs: number;
  logs_by_action: Record<AuditAction, number>;
  logs_by_resource: Record<AuditResource, number>;
  logs_by_user: Array<{
    user_id: string;
    user_name: string;
    count: number;
  }>;
  logs_by_day: Array<{
    date: string;
    count: number;
  }>;
}

export interface AuditQueryDto {
  userId?: string;
  storeId?: string;
  organizationId?: string;
  action?: AuditAction;
  resource?: AuditResource;
  resourceId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}
