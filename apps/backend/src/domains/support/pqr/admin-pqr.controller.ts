import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { RequestContextService } from '../../../common/context/request-context.service';
import { PqrQueryDto } from './dto/pqr-query.dto';

/**
 * Org-admin PQR Controller
 *
 * Aggregated PQR visibility for the ORG_ADMIN role across all stores
 * in the requesting org. Closes the gap where org-owners (clients of
 * Vendix Corp) couldn't see their tenants' PQRs because PQRs lived
 * under the Vendix platform org.
 *
 * All endpoints require ORG_ADMIN role. Cross-org queries are not
 * possible — the guard + org-scoping rejects users with a different
 * org_id. Read-only: stores within the org own the response workflow.
 */
@ApiTags('OrgAdmin PQR')
@ApiBearerAuth()
@Controller('admin/support/pqr')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.OWNER)
export class AdminPqrController {
  constructor(private readonly prisma: GlobalPrismaService) {}

  @Get()
  @ApiOperation({ summary: 'List PQRs across the org' })
  @ApiResponse({ status: 200, description: 'PQRs retrieved successfully' })
  async findAll(@Query() query: PqrQueryDto) {
    const orgId = RequestContextService.getOrganizationId();
    // Strict org scope: only show PQRs that belong to the caller's
    // organization. We deliberately don't include platform-org PQRs
    // (orgVendix) here — those belong to the super-admin's inbox,
    // not the org-admin. orgVendix is the platform admin account,
    // not a tenant, so it shouldn't appear in a tenant's view at all.
    // Legacy rows that had organization_id = orgVendix were an artifact
    // of the pre-fix createPublic flow; after the domain-context fix
    // new PQRs get tagged with the right org_id, so the OR clause is
    // no longer needed and was actively misleading.
    const where: any = {
      organization_id: orgId,
      tags: { has: 'pqr' },
    };
    if (query.status) where.status = query.status;
    if (query.pqr_type) where.category = query.pqr_type;
    if (query.priority) where.priority = query.priority;
    if (query.assigned_to_user_id)
      where.assigned_to_user_id = query.assigned_to_user_id;
    if (query.store_id) where.store_id = query.store_id;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { ticket_number: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.date_from || query.date_to) {
      where.created_at = {};
      if (query.date_from) where.created_at.gte = new Date(query.date_from);
      if (query.date_to) where.created_at.lte = new Date(query.date_to);
    }

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const [total, data] = await Promise.all([
      this.prisma.support_tickets.count({ where }),
      this.prisma.support_tickets.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip,
        include: {
          store: { select: { id: true, name: true, slug: true } },
          // Load the org so the frontend can render the org name in
          // the "Tienda" column when `store_id` is null (typical of
          // legacy PQRs created via the public storefront form,
          // which were parked under the platform org without a
          // store context).
          organization: { select: { id: true, name: true } },
          assigned_to: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
            },
          },
          _count: { select: { comments: true } },
        },
      }),
    ]);

    return {
      success: true,
      data,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Org-scoped PQR statistics' })
  async getStats() {
    const orgId = RequestContextService.getOrganizationId();
    // Strict org scope — same as findAll. orgVendix PQRs are
    // super-admin territory and shouldn't bleed into the org-admin's
    // stats card.
    const where = {
      organization_id: orgId,
      tags: { has: 'pqr' },
    };

    const [
      total,
      byStatus,
      byPriority,
      byType,
      overdue,
      avgResolutionTime,
      recent24h,
    ] = await Promise.all([
      this.prisma.support_tickets.count({ where }),
      this.prisma.support_tickets.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
      this.prisma.support_tickets.groupBy({
        by: ['priority'],
        where,
        _count: true,
      }),
      this.prisma.support_tickets.groupBy({
        by: ['category'],
        where,
        _count: true,
      }),
      this.prisma.support_tickets.count({
        where: {
          ...where,
          sla_deadline: { lt: new Date() },
          status: { notIn: ['RESOLVED', 'CLOSED'] },
        },
      }),
      this.prisma.support_tickets.aggregate({
        where: { ...where, resolution_time_minutes: { not: null } },
        _avg: { resolution_time_minutes: true },
      }),
      this.prisma.support_tickets.count({
        where: {
          ...where,
          created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const byTypeMap: Record<string, number> = {};
    for (const row of byType) byTypeMap[row.category] = row._count;

    return {
      success: true,
      data: {
        total,
        recent_24h: recent24h,
        overdue,
        avg_resolution_time: avgResolutionTime._avg.resolution_time_minutes,
        by_status: byStatus.reduce((acc: any, r) => {
          acc[r.status] = r._count;
          return acc;
        }, {}),
        by_priority: byPriority.reduce((acc: any, r) => {
          acc[r.priority] = r._count;
          return acc;
        }, {}),
        by_type: byTypeMap,
      },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single PQR (org-scoped)' })
  @ApiResponse({ status: 200, description: 'PQR retrieved successfully' })
  @ApiResponse({ status: 404, description: 'PQR not found in this org' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const orgId = RequestContextService.getOrganizationId();
    const ticket = await this.prisma.support_tickets.findUnique({
      where: { id },
      include: {
        store: { select: { id: true, name: true, slug: true } },
        assigned_to: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        comments: {
          orderBy: { created_at: 'asc' },
          include: {
            author: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
        status_history: { orderBy: { created_at: 'desc' } },
      },
    });

    if (
      !ticket ||
      ticket.organization_id !== orgId ||
      !(ticket.tags || []).includes('pqr')
    ) {
      throw new VendixHttpException(ErrorCodes.SUP_TICKET_001);
    }

    return { success: true, data: ticket };
  }
}