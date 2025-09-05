import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Registra un evento de auditoría
   */
  async log(auditData: AuditLogData): Promise<void> {
    try {
      await this.prismaService.audit_logs.create({
        data: {
          user_id: auditData.userId,
          store_id: auditData.storeId,
          organization_id: auditData.organizationId, // ✅ Nuevo campo organization_id
          action: auditData.action,
          resource: auditData.resource,
          resource_id: auditData.resourceId,
          old_values: auditData.oldValues ? JSON.parse(JSON.stringify(auditData.oldValues)) : null,
          new_values: auditData.newValues ? JSON.parse(JSON.stringify(auditData.newValues)) : null,
          ip_address: auditData.ipAddress,
          user_agent: auditData.userAgent,
        },
      });

      // Log console para desarrollo/debugging
      console.log(`📊 AUDIT: ${auditData.action} on ${auditData.resource}${auditData.resourceId ? ` (${auditData.resourceId})` : ''} by user ${auditData.userId || 'system'}`);

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
    metadata?: Record<string, any>
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
    metadata?: Record<string, any>
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
    metadata?: Record<string, any>
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
    userAgent?: string
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
    metadata?: Record<string, any>
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
    userId?: number;
    storeId?: number;
    organizationId?: number; // ✅ Ahora usa campo directo
    action?: AuditAction;
    resource?: AuditResource;
    resourceId?: number;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (filters?.userId) where.user_id = filters.userId;
    if (filters?.storeId) where.store_id = filters.storeId;
    if (filters?.organizationId) where.organization_id = filters.organizationId; // ✅ Filtro directo por organization_id
    if (filters?.action) where.action = filters.action;
    if (filters?.resource) where.resource = filters.resource;
    if (filters?.resourceId) where.resource_id = filters.resourceId;

    if (filters?.fromDate || filters?.toDate) {
      where.created_at = {};
      if (filters.fromDate) where.created_at.gte = filters.fromDate;
      if (filters.toDate) where.created_at.lte = filters.toDate;
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
        organizations: { // ✅ Nueva relación con organizations
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

    return {
      totalLogs,
      logsByAction,
      logsByResource,
    };
  }
}
