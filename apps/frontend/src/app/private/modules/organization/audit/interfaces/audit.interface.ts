export enum AuditAction {
    CREATE = 'CREATE',
    UPDATE = 'UPDATE',
    DELETE = 'DELETE',
    LOGIN = 'LOGIN',
    LOGOUT = 'LOGOUT',
    PASSWORD_CHANGE = 'PASSWORD_CHANGE',
    EMAIL_VERIFY = 'EMAIL_VERIFY',
    ONBOARDING_COMPLETE = 'ONBOARDING_COMPLETE',
    PERMISSION_CHANGE = 'PERMISSION_CHANGE',
    LOGIN_FAILED = 'LOGIN_FAILED',
    ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
    ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',
    SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
    PASSWORD_RESET = 'PASSWORD_RESET',
}

export enum AuditResource {
    USERS = 'users',
    ORGANIZATIONS = 'organizations',
    STORES = 'stores',
    DOMAIN_SETTINGS = 'domain_settings',
    PRODUCTS = 'products',
    ORDERS = 'orders',
    AUTH = 'auth',
    ROLES = 'roles',
    PERMISSIONS = 'permissions',
    SYSTEM = 'system',
}

export interface AuditLog {
    id: number;
    user_id?: number;
    store_id?: number;
    organization_id?: number;
    action: AuditAction;
    resource: AuditResource;
    resource_id?: number;
    old_values?: any;
    new_values?: any;
    metadata?: any;
    ip_address?: string;
    user_agent?: string;
    created_at: string;
    users?: {
        id: number;
        email: string;
        first_name: string;
        last_name: string;
    };
    stores?: {
        id: number;
        name: string;
        slug: string;
    };
}

export interface AuditStats {
    total_logs: number;
    logs_by_action: Record<string, number>;
    logs_by_resource: Record<string, number>;
}

export interface AuditQueryDto {
    user_id?: number;
    store_id?: number;
    action?: AuditAction;
    resource?: AuditResource;
    resource_id?: number;
    from_date?: string;
    to_date?: string;
    limit?: number;
    offset?: number;
    page?: number;
}

export interface PaginatedAuditResponse {
    data: AuditLog[];
    pagination?: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}
