import { Injectable } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import {
    AuditAction,
    AuditResource,
} from '../../superadmin/audit/audit.service';

@Injectable()
export class AuditService {
    constructor(private readonly prismaService: OrganizationPrismaService) { }

    /**
     * Obtiene logs de auditoría con filtros
     * Nota: El filtrado por organización se aplica automáticamente por OrganizationPrismaService
     */
    async getAuditLogs(filters?: {
        user_id?: number;
        store_id?: number;
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
                    },
                },
                stores: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                    },
                },
                // Remove organizations inclusion as we know the organization (it's the current one)
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

        // OrganizationPrismaService automatically scopes these queries
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
