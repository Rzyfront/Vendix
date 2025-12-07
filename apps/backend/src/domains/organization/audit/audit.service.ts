import { Injectable } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
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

export interface AuditLogData {
  userId?: number;
  storeId?: number;
  organizationId?: number; // ✅ Nuevo campo para organización directa
  action: AuditAction;
  resource: AuditResource;
  resourceId?: number;
  oldValues?: any;
  newValues?: any;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prismaService: OrganizationPrismaService) { }

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
            RequestContextService.getContext()?.organization_id, // ✅ Nuevo campo organization_id con fallback a contexto
          action: auditData.action,
          resource: auditData.resource,
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

      // Log console para desarrollo/debugging
      console.log(
        `📊 AUDIT: ${auditData.action} on ${auditData.resource}${auditData.resourceId ? ` (${auditData.resourceId})` : ''} by user ${auditData.userId || 'system'}`,
      );
    } catch (error) {
      // No fallar la operación principal por error de auditoría
      console.error('❌ Error registrando auditoría:', error);
    }
  }

  /**
   * Registra creación de recurso
   */
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

  /**
   * Registra actualización de recurso
   */
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

  /**
   * Registra eliminación de recurso
   */
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

  /**
   * Registra eventos de autenticación
   */
  async logAuth(
    userId: number | undefined,
    action: AuditAction,
    metadata?: Record<string, any>,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      userId,
      action,
      resource: AuditResource.AUTH,
      metadata,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Registra eventos del sistema
   */
  async logSystem(
    action: AuditAction,
    resource: AuditResource,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.log({
      action,
      resource,
      metadata,
    });
  }

  /**
   * Obtiene logs de auditoría con filtros
   */
  async getAuditLogs(filters?: {
    user_id?: number;
    store_id?: number;
    // organization_id?: number; // Eliminado: se usa el contexto
    action?: AuditAction;
    resource?: AuditResource;
    resource_id?: number;
    from_date?: Date;
    to_date?: Date;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (filters?.user_id) where.user_id = filters.user_id;
    if (filters?.store_id) where.store_id = filters.store_id;
    // Organization filtering handled automatically by OrganizationPrismaService
    if (filters?.action) where.action = filters.action;
    if (filters?.resource) where.resource = filters.resource;
    if (filters?.resource_id) where.resource_id = filters.resource_id;

    if (filters?.from_date || filters?.to_date) {
      where.created_at = {};
      if (filters.from_date) where.created_at.gte = filters.from_date;
      if (filters.to_date) where.created_at.lte = filters.to_date;
    }

    return await this.prismaService.audit_logs.findMany({
      where,
      include: {
        users: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
            organization_id: true,
          },
        },
        stores: {
          select: {
            id: true,
            name: true,
            slug: true,
            organization_id: true,
          },
        },
        organizations: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    });
  }

  /**
   * Obtiene estadísticas de auditoría
   */
  async getAuditStats(fromDate?: Date, toDate?: Date) {
    const where: any = {};

    if (fromDate || toDate) {
      where.created_at = {};
      if (fromDate) where.created_at.gte = fromDate;
      if (toDate) where.created_at.lte = toDate;
    }

    const context = RequestContextService.getContext();
    if (context?.organization_id) {
      where.organization_id = context.organization_id;
    }

    const [totalLogs, logsByAction, logsByResource] = await Promise.all([
      this.prismaService.audit_logs.count({ where }),
      this.prismaService.audit_logs.groupBy({
        by: ['action'],
        where,
        _count: { id: true },
      }),
      this.prismaService.audit_logs.groupBy({
        by: ['resource'],
        where,
        _count: { id: true },
      }),
    ]);

    // Convertir a la estructura que espera el frontend
    const logsByActionFormatted: Record<string, number> = {};
    logsByAction.forEach((item) => {
      logsByActionFormatted[item.action] = item._count.id;
    });

    const logsByResourceFormatted: Record<string, number> = {};
    logsByResource.forEach((item) => {
      logsByResourceFormatted[item.resource] = item._count.id;
    });

    return {
      total_logs: totalLogs,
      logs_by_action: logsByActionFormatted,
      logs_by_resource: logsByResourceFormatted,
    };
  }
}
