import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

import {
  AuditAction,
  AuditResource,
} from '../../../common/audit/audit.service';

/** Ventana fija de la serie `logs_by_day`, en días. */
const LOGS_BY_DAY_WINDOW = 30;

/**
 * Alcance explícito para `getAuditStats`.
 *
 * Sin esto, las estadísticas se anclaban siempre a la organización del super
 * admin que consulta, así que era imposible pedir las de otro tenant. Es
 * OPCIONAL: omitirlo conserva el comportamiento anterior intacto.
 */
export interface AuditStatsScope {
  /**
   * Organización a medir. `undefined` ⇒ se usa la del contexto (comportamiento
   * histórico). `null` ⇒ sin filtro de organización, es decir toda la
   * plataforma; pedirlo es una decisión consciente de quien llama.
   */
  organization_id?: number | null;
  /** Tienda a medir dentro de la organización. `undefined` ⇒ sin filtro. */
  store_id?: number | null;
}

@Injectable()
export class SuperAdminAuditService {
  constructor(private readonly prismaService: GlobalPrismaService) {}

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
   * Obtiene estadísticas de auditoría.
   *
   * `scope` es opcional y retrocompatible: sin él, la organización sigue
   * saliendo del contexto del super admin que consulta, que es lo que espera
   * el consumidor actual (`superadmin/admin/audit` + `audit.component.ts`).
   * Pasándolo se pueden pedir las estadísticas de OTRO tenant, que antes era
   * imposible porque el `organization_id` del contexto se imponía siempre.
   */
  async getAuditStats(fromDate?: Date, toDate?: Date, scope?: AuditStatsScope) {
    const where: any = {};

    if (fromDate || toDate) {
      where.created_at = {};
      if (fromDate) where.created_at.gte = fromDate;
      if (toDate) where.created_at.lte = toDate;
    }

    // `undefined` ⇒ organización del contexto (comportamiento histórico).
    // `null` explícito ⇒ el que llama pide toda la plataforma a sabiendas.
    const organizationId =
      scope && 'organization_id' in scope
        ? scope.organization_id
        : RequestContextService.getContext()?.organization_id;

    if (organizationId) {
      where.organization_id = organizationId;
    }
    if (scope?.store_id) {
      where.store_id = scope.store_id;
    }

    const [totalLogs, logsByAction, logsByResource, logsByUser] =
      await Promise.all([
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
      email: string | null;
    }

    const users =
      userIds.length > 0
        ? await this.prismaService.users.findMany({
            where: { id: { in: userIds } },
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          })
        : [];

    const userMap = new Map<number, UserDetail>(
      users.map((u: UserDetail) => [u.id, u]),
    );

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
        const user = userMap.get(item.user_id);
        const userName = user
          ? `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
            user.email
          : 'Unknown';
        return {
          user_id: String(item.user_id),
          user_name: userName,
          count: item._count.id,
        };
      });

    // Serie de los últimos 30 días.
    //
    // Antes eran 30 `count()` SECUENCIALES dentro de un bucle: treinta viajes a
    // la base con el mismo predicado salvo el rango, uno esperando al anterior.
    // Ahora es un único GROUP BY y el zero-fill se resuelve en memoria.
    //
    // La FORMA de la respuesta no cambia y es deliberado: 30 entradas exactas,
    // `date` en `YYYY-MM-DD` y orden ascendente, igual que antes, porque el
    // frontend existente (`audit-stats.component.ts`) las consume así.
    //
    // El bucket sigue siendo UTC, también igual que antes: esta vista agrega
    // tenants de husos distintos, así que no hay una zona de tienda aplicable
    // (mismo criterio documentado en superadmin/dashboard).
    //
    // Igual que el bucle original, ignora `where.created_at`: la serie SIEMPRE
    // cubre los últimos 30 días, con independencia del filtro de fechas.
    const dayWindowStart = new Date();
    dayWindowStart.setUTCHours(0, 0, 0, 0);
    dayWindowStart.setUTCDate(
      dayWindowStart.getUTCDate() - (LOGS_BY_DAY_WINDOW - 1),
    );
    const dayWindowEnd = new Date(dayWindowStart);
    dayWindowEnd.setUTCDate(dayWindowEnd.getUTCDate() + LOGS_BY_DAY_WINDOW);

    // Mismos filtros de tenant que el resto de estadísticas, escritos a mano
    // porque la consulta cruda no pasa por las extensiones de Prisma.
    const dayFilters: Prisma.Sql[] = [
      Prisma.sql`created_at >= ${dayWindowStart}`,
      Prisma.sql`created_at < ${dayWindowEnd}`,
    ];
    if (organizationId) {
      dayFilters.push(Prisma.sql`organization_id = ${organizationId}`);
    }
    if (scope?.store_id) {
      dayFilters.push(Prisma.sql`store_id = ${scope.store_id}`);
    }

    const dayRows = await this.prismaService.withoutScope().$queryRaw<
      Array<{ day: string; count: number }>
    >`
      SELECT to_char(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count -- tz-audit:ignore vista cross-tenant: el bucket UTC es deliberado
      FROM audit_logs
      WHERE ${Prisma.join(dayFilters, ' AND ')}
      GROUP BY 1
    `;

    const dayCounts = new Map(
      dayRows.map((row) => [row.day, Number(row.count)]),
    );

    const logsByDayFormatted: Array<{ date: string; count: number }> = [];
    for (let i = 0; i < LOGS_BY_DAY_WINDOW; i++) {
      const cursor = new Date(dayWindowStart);
      cursor.setUTCDate(cursor.getUTCDate() + i);
      const date = cursor.toISOString().split('T')[0];
      logsByDayFormatted.push({ date, count: dayCounts.get(date) ?? 0 });
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
