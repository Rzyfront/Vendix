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
import { PqrQueryDto } from '../../support/pqr/dto/pqr-query.dto';

/**
 * Superadmin PQR Controller
 *
 * Provides global visibility into Peticiones, Quejas y Reclamos (PQRs)
 * across the entire platform. Required because PQRs are platform-scoped
 * (all PQRs live under the Vendix orgVendix organization in
 * `support_tickets`, discriminated by `tags: { has: 'pqr' }`) and
 * super-admins need compliance oversight without going through each
 * tenant.
 *
 * The super-admin Soporte/Tickets view excludes PQRs to keep the two
 * domains separate (see support.service.ts findAll comment). This
 * controller is the dedicated home for global PQR oversight.
 *
 * All endpoints require SUPER_ADMIN role.
 */
@ApiTags('Superadmin PQR')
@ApiBearerAuth()
@Controller('superadmin/support/pqrs')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SuperadminPqrsController {
  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * List all PQRs across the platform.
   * Filterable by status, pqr_type, priority, search, assigned_to.
   */
  @Get()
  @ApiOperation({ summary: 'List all PQRs across the platform' })
  @ApiResponse({ status: 200, description: 'PQRs retrieved successfully' })
  async findAll(@Query() query: PqrQueryDto) {
    const where: any = {
      // PQR discriminator — matches pqr.service.ts:143
      tags: { has: 'pqr' },
    };

    if (query.status) where.status = query.status;
    if (query.pqr_type) where.category = query.pqr_type;
    if (query.priority) where.priority = query.priority;
    if (query.assigned_to_user_id) {
      where.assigned_to_user_id = query.assigned_to_user_id;
    }
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
          // No organization/store includes because PQRs always belong
          // to orgVendix (platform org). Resolved name helps the UI
          // label the row consistently with other super-admin tables.
          organization: {
            select: { id: true, name: true, slug: true },
          },
          store: { select: { id: true, name: true, slug: true } },
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
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Global PQR stats (counts by status, type, priority; SLA overdue;
   * avg resolution time). Mirrors the store-admin PQR stats shape so
   * the frontend can reuse the same component cards.
   */
  @Get('stats')
  @ApiOperation({ summary: 'Global PQR statistics' })
  async getStats() {
    const where = { tags: { has: 'pqr' } };

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

    // by_type mirrors by_category — frontend can use either name.
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

  /**
   * Single PQR detail. PQRs share the same id space as support tickets,
   * so a direct lookup works. Returns 404 if the id is not a PQR
   * (defense in depth — the Soporte controller already enforces this
   * from its own side).
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get a single PQR by ID' })
  @ApiResponse({ status: 200, description: 'PQR retrieved successfully' })
  @ApiResponse({ status: 404, description: 'PQR not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const ticket = await this.prisma.support_tickets.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
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
        status_history: {
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!ticket || !(ticket.tags || []).includes('pqr')) {
      throw new VendixHttpException(ErrorCodes.SUP_TICKET_001);
    }

    return { success: true, data: ticket };
  }
}