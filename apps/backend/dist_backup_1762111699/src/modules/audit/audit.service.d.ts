import { PrismaService } from '../../prisma/prisma.service';
export declare enum AuditAction {
    CREATE = "CREATE",
    UPDATE = "UPDATE",
    DELETE = "DELETE",
    LOGIN = "LOGIN",
    LOGOUT = "LOGOUT",
    PASSWORD_CHANGE = "PASSWORD_CHANGE",
    EMAIL_VERIFY = "EMAIL_VERIFY",
    ONBOARDING_COMPLETE = "ONBOARDING_COMPLETE",
    PERMISSION_CHANGE = "PERMISSION_CHANGE",
    LOGIN_FAILED = "LOGIN_FAILED",
    ACCOUNT_LOCKED = "ACCOUNT_LOCKED",
    ACCOUNT_UNLOCKED = "ACCOUNT_UNLOCKED",
    SUSPICIOUS_ACTIVITY = "SUSPICIOUS_ACTIVITY",
    PASSWORD_RESET = "PASSWORD_RESET"
}
export declare enum AuditResource {
    USERS = "users",
    ORGANIZATIONS = "organizations",
    STORES = "stores",
    DOMAIN_SETTINGS = "domain_settings",
    PRODUCTS = "products",
    ORDERS = "orders",
    AUTH = "auth",
    ROLES = "roles",
    PERMISSIONS = "permissions",
    SYSTEM = "system"
}
export interface AuditLogData {
    userId?: number;
    storeId?: number;
    organizationId?: number;
    action: AuditAction;
    resource: AuditResource;
    resourceId?: number;
    oldValues?: any;
    newValues?: any;
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
}
export declare class AuditService {
    private readonly prismaService;
    constructor(prismaService: PrismaService);
    log(auditData: AuditLogData): Promise<void>;
    logCreate(userId: number, resource: AuditResource, resourceId: number, newValues: any, metadata?: Record<string, any>): Promise<void>;
    logUpdate(userId: number, resource: AuditResource, resourceId: number, oldValues: any, newValues: any, metadata?: Record<string, any>): Promise<void>;
    logDelete(userId: number, resource: AuditResource, resourceId: number, oldValues: any, metadata?: Record<string, any>): Promise<void>;
    logAuth(userId: number | undefined, action: AuditAction, metadata?: Record<string, any>, ipAddress?: string, userAgent?: string): Promise<void>;
    logSystem(action: AuditAction, resource: AuditResource, metadata?: Record<string, any>): Promise<void>;
    getAuditLogs(filters?: {
        userId?: number;
        storeId?: number;
        organizationId?: number;
        action?: AuditAction;
        resource?: AuditResource;
        resourceId?: number;
        fromDate?: Date;
        toDate?: Date;
        limit?: number;
        offset?: number;
    }): Promise<any>;
    getAuditStats(fromDate?: Date, toDate?: Date): Promise<{
        total_logs: any;
        logs_by_action: Record<string, number>;
        logs_by_resource: Record<string, number>;
    }>;
}
