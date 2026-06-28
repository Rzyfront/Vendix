import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ticket_category_enum } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { PqrService } from '../../support/pqr/pqr.service';
import { PqrQueryDto } from '../../support/pqr/dto/pqr-query.dto';
import { UpdatePqrStatusDto } from '../../support/pqr/dto/update-pqr-status.dto';
import { AssignPqrDto } from '../../support/pqr/dto/assign-pqr.dto';
import { AddPqrCommentDto } from '../../support/pqr/dto/add-pqr-comment.dto';

/**
 * Superadmin PQR Controller
 *
 * Provides global visibility into Peticiones, Quejas y Reclamos (PQRs)
 * across the entire platform. PQRS rows are discriminated from generic
 * support tickets by `category` (one of PETITION | COMPLAINT | CLAIM |
 * SUGGESTION in the `ticket_category_enum`), NOT by a tag. The
 * `category` check is more robust than `tags: { has: 'pqr' }` because:
 *  - It's set declaratively in schema.prisma → always populated.
 *  - It's an enum → indexed, type-safe, can't drift to typos.
 *  - It survives migrations / seeders / manual fixes that might miss
 *    the legacy tag-population step.
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
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly pqrService: PqrService,
  ) {}

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
    const ticket = await this.prisma.support_tickets.findFirst({
      where: {
        id,
        // Two-discriminator PQR match. Either condition suffices:
        //
        //   (a) tags includes 'pqr'  → modern + legacy rows tagged by
        //                              createPublic() at line 177 of
        //                              pqr.service.ts.
        //   (b) category IN (PETITION, COMPLAINT, CLAIM, SUGGESTION)
        //                            → enum-based canonical signal set
        //                              by mapPqrType() at create time.
        //
        // We OR the two so a row is visible if EITHER discriminator
        // is set. Avoids the silent-404 case where a row has one
        // discriminator populated but not the other (different code
        // paths, manual fixes, migrations that touched one signal
        // without the other).
        OR: [
          { tags: { has: 'pqr' } },
          {
            category: {
              in: [
                ticket_category_enum.PETITION,
                ticket_category_enum.COMPLAINT,
                ticket_category_enum.CLAIM,
                ticket_category_enum.SUGGESTION,
              ],
            },
          },
        ],
      },
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

    if (!ticket) {
      throw new VendixHttpException(ErrorCodes.SUP_TICKET_001);
    }

    return { success: true, data: ticket };
  }

  /**
   * Add a comment to a PQR. Mirrors `POST /store/support/pqr/:id/comments`
   * but for the super-admin actor. Comments can be public (visible to the
   * requester) or internal (scratchpad). Public comments trigger an
   * email to the requester with the response — this is the channel
   * super-admins use to actually answer the platform-wide PQRs that
   * arrive via `POST /pqr` (since those land at admin@vendix.online).
   */
  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment to a PQR (super-admin)' })
  @ApiResponse({ status: 201, description: 'Comment added' })
  async addComment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddPqrCommentDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Tu sesión expiró o no se reconoce al usuario autenticado. Vuelve a iniciar sesión e intenta de nuevo.',
      );
    }
    return this.pqrService.adminAddComment(id, dto, userId);
  }

  /**
   * Edit a comment's content. Server-side: only the original author
   * can edit (SUP_COMMENT_002 → 403 otherwise) so attribution stays
   * truthful. Appends a status_history row noting the change so the
   * History card surfaces "Comentario editado por X" with the byte
   * delta in change_notes.
   */
  @Patch(':id/comments/:commentId')
  @ApiOperation({ summary: 'Edit a comment (author only)' })
  @ApiResponse({ status: 200, description: 'Comment edited' })
  @ApiResponse({
    status: 403,
    description: 'Only the original author can edit the comment',
  })
  async editComment(
    @Param('id', ParseIntPipe) id: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() dto: { content: string },
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Tu sesión expiró o no se reconoce al usuario autenticado. Vuelve a iniciar sesión e intenta de nuevo.',
      );
    }
    return this.pqrService.adminUpdateComment(
      id,
      commentId,
      dto.content,
      userId,
    );
  }

  /**
   * Update the status of a PQR. Triggers status_history entries and the
   * standard email side-effects (notify requester when resolving/closing).
   */
  @Patch(':id/status')
  @ApiOperation({ summary: 'Update PQR status (super-admin)' })
  @ApiResponse({ status: 200, description: 'Status updated' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePqrStatusDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Tu sesión expiró o no se reconoce al usuario autenticado. Vuelve a iniciar sesión e intenta de nuevo.',
      );
    }
    return this.pqrService.adminUpdateStatus(id, dto, userId);
  }

  /**
   * Assign a PQR to a Vendix internal user (super-admin or operator).
   * Used for routing platform PQRs to the right on-call person.
   */
  @Patch(':id/assign')
  @ApiOperation({ summary: 'Assign a PQR to an internal user (super-admin)' })
  @ApiResponse({ status: 200, description: 'PQR assigned' })
  async assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignPqrDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Tu sesión expiró o no se reconoce al usuario autenticado. Vuelve a iniciar sesión e intenta de nuevo.',
      );
    }
    return this.pqrService.adminAssign(id, dto, userId);
  }

  /**
   * Edit the title / description / requester fields of a PQR.
   *
   * Super-admin callers can edit at any status (no NEW-only guard) —
   * the support team is the source of truth for these rows and may
   * need to correct contact data or typo'd titles even mid-flight.
   * Each edit still inserts a row in `support_status_history` so the
   * History card surfaces "Editó X → Y" with the diff.
   */
  @Patch(':id/content')
  @ApiOperation({
    summary: 'Edit PQR content fields (super-admin — no status guard)',
  })
  @ApiResponse({ status: 200, description: 'Content edited' })
  async editContent(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    dto: {
      title?: string;
      description?: string;
      requester_first_name?: string;
      requester_last_name?: string;
      requester_email?: string;
      requester_phone?: string;
      requester_document_type?: string;
      requester_document_num?: string;
    },
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Tu sesión expiró o no se reconoce al usuario autenticado. Vuelve a iniciar sesión e intenta de nuevo.',
      );
    }
    return this.pqrService.editContent(id, dto, userId, {
      bypassStatusGuard: true,
    });
  }
}