import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

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
    VIEW = 'VIEW',
    SEARCH = 'SEARCH',
    CUSTOM = 'CUSTOM', // ✅ Acción para eventos personalizados
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
    ADDRESSES = 'addresses',
    CATEGORIES = 'categories',
    BRANDS = 'brands',
    CUSTOMERS = 'customers',
    SUPPLIERS = 'suppliers',
    INVENTORY = 'inventory',
    STOCK_LEVELS = 'stock_levels',
    TRANSACTIONS = 'transactions',
    PAYMENTS = 'payments',
    TAXES = 'taxes',
    DOMAINS = 'domains',
    SETTINGS = 'settings',
    TEMPLATES = 'templates',
    CUSTOM = 'custom', // ✅ Recurso genérico para eventos personalizados
}

export interface AuditLogData {
    userId?: number;
    storeId?: number;
    organizationId?: number;
    action: AuditAction | string; // Permitir strings arbitrarios para CUSTOM
    resource: AuditResource | string; // Permitir strings arbitrarios para CUSTOM
    resourceId?: number;
    oldValues?: any;
    newValues?: any;
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
}

@Injectable()
export class AuditService {
    constructor(private readonly prismaService: GlobalPrismaService) { }

    /**
     * Registra un evento de auditoría
     */
    async log(auditData: AuditLogData): Promise<void> {
        try {
            await this.prismaService.audit_logs.create({
                data: {
                    user_id: auditData.userId,
                    store_id: auditData.storeId,
                    organization_id:
                        auditData.organizationId ||
                        RequestContextService.getContext()?.organization_id,
                    // Si la acción no es parte del Enum, se guarda tal cual (si la BD lo permite) o se mapea a CUSTOM si es muy estricto.
                    // Asumimos que la columna en BD es string o enum compatible.
                    action: auditData.action as any,
                    resource: auditData.resource as any,
                    resource_id: auditData.resourceId,
                    old_values: auditData.oldValues
                        ? JSON.parse(JSON.stringify(auditData.oldValues))
                        : null,
                    new_values: auditData.newValues
                        ? JSON.parse(JSON.stringify(auditData.newValues))
                        : null,
                    ip_address: auditData.ipAddress,
                    user_agent: auditData.userAgent,
                },
            });


        } catch (error) {
            // Error registrando auditoría - log for debugging
            console.error('[AuditService] Error creating audit log:', error.message);
            console.error('[AuditService] Audit data:', {
                userId: auditData.userId,
                action: auditData.action,
                resource: auditData.resource,
                resourceId: auditData.resourceId,
                hasOldValues: !!auditData.oldValues,
                hasNewValues: !!auditData.newValues,
                oldValuesSize: auditData.oldValues ? JSON.stringify(auditData.oldValues).length : 0,
                newValuesSize: auditData.newValues ? JSON.stringify(auditData.newValues).length : 0,
            });
        }
    }

    /**
     * Helper para registrar eventos personalizados en flujos específicos
     */
    async logCustom(
        userId: number,
        action: string,
        resource: string,
        metadata?: Record<string, any>,
        resourceId?: number,
    ): Promise<void> {
        await this.log({
            userId,
            action: action,
            resource: resource,
            resourceId,
            metadata,
        });
    }

    async logCreate(
        userId: number,
        resource: AuditResource,
        resourceId: number,
        newValues: any,
        metadata?: Record<string, any>,
    ): Promise<void> {
        await this.log({
            userId,
            action: AuditAction.CREATE,
            resource,
            resourceId,
            newValues,
            metadata,
        });
    }

    async logUpdate(
        userId: number,
        resource: AuditResource,
        resourceId: number,
        oldValues: any,
        newValues: any,
        metadata?: Record<string, any>,
    ): Promise<void> {
        await this.log({
            userId,
            action: AuditAction.UPDATE,
            resource,
            resourceId,
            oldValues,
            newValues,
            metadata,
        });
    }

    async logDelete(
        userId: number,
        resource: AuditResource,
        resourceId: number,
        oldValues: any,
        metadata?: Record<string, any>,
    ): Promise<void> {
        await this.log({
            userId,
            action: AuditAction.DELETE,
            resource,
            resourceId,
            oldValues,
            metadata,
        });
    }

    async logAuth(
        userId: number | undefined,
        action: AuditAction,
        metadata?: Record<string, any>,
        ipAddress?: string,
        userAgent?: string,
    ): Promise<void> {
        // Extract organization_id and store_id from metadata if provided
        // This is important for auth events (LOGIN, LOGOUT) where RequestContext
        // might not have the context yet
        const organizationId = metadata?.organization_id as number | undefined;
        const storeId = metadata?.store_id as number | undefined;

        // Remove organization_id and store_id from metadata to avoid duplication
        const { organization_id, store_id, ...cleanMetadata } = metadata || {};

        await this.log({
            userId,
            action,
            resource: AuditResource.AUTH,
            organizationId,
            storeId,
            metadata: cleanMetadata,
            ipAddress,
            userAgent,
        });
    }
}
