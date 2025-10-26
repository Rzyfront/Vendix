export interface AuditLog {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  organization_id: string;
  organization_name: string;
  store_id: string;
  store_name: string;
  action: AuditAction;
  resource: AuditResource;
  resource_id: string;
  old_data: Record<string, any> | null;
  new_data: Record<string, any> | null;
  ip_address: string;
  user_agent: string;
  created_at: string;
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  READ = 'READ',
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
