import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

import {
  AuditAction,
  AuditResource,
} from '../../../common/audit/audit.service';

@Injectable()
export class SuperAdminAuditService {
  constructor(private readonly prismaService: GlobalPrismaService) { }

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

    const [
      totalLogs,
      logsByAction,
      logsByResource,
      logsByUser,
    ] = await Promise.all([
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
      // Top users by activity
      this.prismaService.audit_logs.groupBy({
        by: ['user_id'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ]);

    // Get user details for logs by user
    const userIds = logsByUser
      .map((item: any) => item.user_id)
      .filter((id): id is number => id !== null && id !== undefined);

    interface UserDetail {
      id: number;
      first_name: string | null;
      last_name: string | null;
      email: string;
    }

    const users = userIds.length > 0
      ? await this.prismaService.users.findMany({
          where: { id: { in: userIds } },
          select: { id: true, first_name: true, last_name: true, email: true },
        })
      : [];

    const userMap = new Map<number, UserDetail>(users.map((u: UserDetail) => [u.id, u]));

    // Convertir a la estructura que espera el frontend
    const logsByActionFormatted: Record<string, number> = {};
    logsByAction.forEach((item: any) => {
      logsByActionFormatted[item.action] = item._count.id;
    });

    const logsByResourceFormatted: Record<string, number> = {};
    logsByResource.forEach((item: any) => {
      logsByResourceFormatted[item.resource] = item._count.id;
    });

    const logsByUserFormatted = logsByUser
      .filter((item: any) => item.user_id !== null)
      .map((item: any) => {
        const user = userMap.get(item.user_id!);
        const userName = user
          ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email
          : 'Unknown';
        return {
          user_id: String(item.user_id),
          user_name: userName,
          count: item._count.id,
        };
      });

    // Calculate logs by day for the last 30 days
    const logsByDayFormatted: Array<{ date: string; count: number }> = [];
    const daysToLookBack = 30;
    for (let i = daysToLookBack - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const count = await this.prismaService.audit_logs.count({
        where: {
          ...where,
          created_at: {
            gte: date,
            lt: nextDate,
          },
        },
      });

      logsByDayFormatted.push({
        date: date.toISOString().split('T')[0],
        count,
      });
    }

    return {
      total_logs: totalLogs,
      logs_by_action: logsByActionFormatted,
      logs_by_resource: logsByResourceFormatted,
      logs_by_user: logsByUserFormatted,
      logs_by_day: logsByDayFormatted,
    };
  }
}
