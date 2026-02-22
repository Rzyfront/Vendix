import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { AssignTicketDto } from './dto/ticket-assignment.dto';
import { UpdateTicketStatusDto, CloseTicketDto } from './dto/ticket-status.dto';
import { Prisma, ticket_status_enum, ticket_priority_enum, ticket_category_enum } from '@prisma/client';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    organizationId: number,
    storeId: number | undefined,
    userId: number,
    createTicketDto: CreateTicketDto,
  ) {
    try {
      // Get organization for S3 path
      const organization = await this.prisma.organizations.findUnique({
        where: { id: organizationId },
        select: { id: true, slug: true },
      });

      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Generate ticket number
      const ticketNumber = await this.generateTicketNumber(organizationId);

      // Calculate SLA deadline based on priority
      const slaDeadline = this.calculateSlaDeadline(
        createTicketDto.priority || ticket_priority_enum.P3,
      );

      // Create ticket
      const ticket = await this.prisma.support_tickets.create({
        data: {
          ticket_number: ticketNumber,
          organization_id: organizationId,
          store_id: storeId,
          created_by_user_id: userId,
          title: createTicketDto.title,
          description: createTicketDto.description,
          category: createTicketDto.category || ticket_category_enum.QUESTION,
          priority: createTicketDto.priority || ticket_priority_enum.P3,
          status: ticket_status_enum.NEW,
          related_order_id: createTicketDto.related_order_id,
          related_order_type: createTicketDto.related_order_type,
          related_product_id: createTicketDto.related_product_id,
          tags: createTicketDto.tags || [],
          sla_deadline: slaDeadline,
          created_at: new Date(),
          updated_at: new Date(),
        },
        include: {
          created_by: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
            },
          },
        },
      });

      // Handle attachments if any
      if (createTicketDto.attachments && createTicketDto.attachments.length > 0) {
        await this.handleAttachments(
          ticket.id,
          organization,
          createTicketDto.attachments,
          userId,
        );
      }

      // Emit event for notifications
      this.eventEmitter.emit('ticket.created', {
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
        organization_id: ticket.organization_id,
        store_id: ticket.store_id,
        created_by_user_id: userId,
        priority: ticket.priority,
        category: ticket.category,
        title: ticket.title,
      });

      this.logger.log(`Ticket created: ${ticketNumber}`);
      return { success: true, data: ticket };
    } catch (error) {
      this.logger.error(`Error creating ticket: ${error.message}`);
      throw error;
    }
  }

  async findAll(
    organizationId: number,
    storeId: number | undefined,
    query: TicketQueryDto,
  ) {
    try {
      const where: any = {
        organization_id: organizationId,
      };

      if (storeId) {
        where.store_id = storeId;
      }

      // Apply filters
      if (query.status) {
        where.status = query.status;
      }
      if (query.priority) {
        where.priority = query.priority;
      }
      if (query.category) {
        where.category = query.category;
      }
      if (query.assigned_to_user_id) {
        where.assigned_to_user_id = query.assigned_to_user_id;
      }
      if (query.customer_id) {
        where.created_by_user_id = query.customer_id;
      }
      if (query.search) {
        where.OR = [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { ticket_number: { contains: query.search, mode: 'insensitive' } },
        ];
      }
      if (query.tag) {
        where.tags = {
          has: query.tag,
        };
      }
      if (query.date_from || query.date_to) {
        where.created_at = {};
        if (query.date_from) {
          where.created_at.gte = new Date(query.date_from);
        }
        if (query.date_to) {
          where.created_at.lte = new Date(query.date_to);
        }
      }

      const page = Number(query.page) || 1;
      const limit = Number(query.limit) || 10;

      const [total, data] = await Promise.all([
        this.prisma.support_tickets.count({ where }),
        this.prisma.support_tickets.findMany({
          where,
          orderBy: { created_at: 'desc' },
          take: limit,
          skip: (page - 1) * limit,
          include: {
            created_by: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
            assigned_to: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
            attachments: {
              select: {
                id: true,
                file_name: true,
                file_key: true,
                thumbnail_key: true,
                file_type: true,
              },
            },
            _count: {
              select: {
                comments: true,
              },
            },
          },
        }),
      ]);

      // Sign URLs for attachments
      const ticketsWithUrls = await Promise.all(
        data.map(async (ticket) => {
          const attachmentsWithUrls = await Promise.all(
            ticket.attachments.map(async (att) => ({
              ...att,
              file_url: await this.s3Service.signUrl(att.file_key),
              thumbnail_url: att.thumbnail_key
                ? await this.s3Service.signUrl(att.thumbnail_key)
                : null,
            })),
          );

          return {
            ...ticket,
            attachments: attachmentsWithUrls,
          };
        }),
      );

      return {
        success: true,
        data: ticketsWithUrls,
        meta: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Error fetching tickets: ${error.message}`);
      throw error;
    }
  }

  async findOne(ticketId: number) {
    try {
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: ticketId },
        include: {
          created_by: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
              phone: true,
            },
          },
          assigned_to: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
            },
          },
          attachments: true,
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
            include: {
              changed_by: {
                select: {
                  id: true,
                  email: true,
                  first_name: true,
                  last_name: true,
                },
              },
            },
          },
        },
      });

      if (!ticket) {
        throw new NotFoundException('Ticket not found');
      }

      // Sign URLs for attachments
      const attachmentsWithUrls = await Promise.all(
        ticket.attachments.map(async (att) => ({
          ...att,
          file_url: await this.s3Service.signUrl(att.file_key),
          thumbnail_url: att.thumbnail_key
            ? await this.s3Service.signUrl(att.thumbnail_key)
            : null,
        })),
      );

      return {
        success: true,
        data: {
          ...ticket,
          attachments: attachmentsWithUrls,
        },
      };
    } catch (error) {
      this.logger.error(`Error fetching ticket: ${error.message}`);
      throw error;
    }
  }

  async update(ticketId: number, updateTicketDto: UpdateTicketDto, userId: number) {
    try {
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: ticketId },
      });

      if (!ticket) {
        throw new NotFoundException('Ticket not found');
      }

      const updated = await this.prisma.support_tickets.update({
        where: { id: ticketId },
        data: updateTicketDto as unknown as Prisma.support_ticketsUncheckedUpdateInput,
      });

      // Emit event if status changed
      if (updateTicketDto.status && updateTicketDto.status !== ticket.status) {
        this.eventEmitter.emit('ticket.status_changed', {
          ticket_id: ticket.id,
          ticket_number: ticket.ticket_number,
          old_status: ticket.status,
          new_status: updateTicketDto.status,
          changed_by_user_id: userId,
        });
      }

      return { success: true, data: updated };
    } catch (error) {
      this.logger.error(`Error updating ticket: ${error.message}`);
      throw error;
    }
  }

  async assign(ticketId: number, assignDto: AssignTicketDto, userId: number) {
    try {
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: ticketId },
      });

      if (!ticket) {
        throw new NotFoundException('Ticket not found');
      }

      // Update ticket
      const updated = await this.prisma.support_tickets.update({
        where: { id: ticketId },
        data: {
          assigned_to_user_id: assignDto.assigned_to_user_id,
          status: ticket_status_enum.OPEN,
          updated_at: new Date(),
        },
        include: {
          assigned_to: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
            },
          },
        },
      });

      // Create status history
      await this.prisma.support_status_history.create({
        data: {
          ticket_id: ticketId,
          old_status: ticket.status,
          new_status: ticket_status_enum.OPEN,
          change_reason: `Assigned to user ${assignDto.assigned_to_user_id}${assignDto.notes ? ': ' + assignDto.notes : ''}`,
          changed_by_user_id: userId,
          created_at: new Date(),
        },
      });

      // Emit event
      this.eventEmitter.emit('ticket.assigned', {
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
        assigned_to_user_id: assignDto.assigned_to_user_id,
        assigned_by_user_id: userId,
      });

      return { success: true, data: updated };
    } catch (error) {
      this.logger.error(`Error assigning ticket: ${error.message}`);
      throw error;
    }
  }

  async updateStatus(
    ticketId: number,
    statusDto: UpdateTicketStatusDto,
    userId: number,
  ) {
    try {
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: ticketId },
      });

      if (!ticket) {
        throw new NotFoundException('Ticket not found');
      }

      const updateData: any = {
        status: statusDto.status,
        updated_at: new Date(),
      };

      // Set timestamps based on status
      if (statusDto.status === ticket_status_enum.RESOLVED) {
        updateData.resolved_at = new Date();
      } else if (statusDto.status === ticket_status_enum.CLOSED) {
        updateData.closed_at = new Date();
      }

      const updated = await this.prisma.support_tickets.update({
        where: { id: ticketId },
        data: updateData,
      });

      // Create status history
      await this.prisma.support_status_history.create({
        data: {
          ticket_id: ticketId,
          old_status: ticket.status,
          new_status: statusDto.status,
          change_reason: statusDto.reason,
          change_notes: statusDto.notes,
          changed_by_user_id: userId,
          created_at: new Date(),
        },
      });

      // Emit event
      this.eventEmitter.emit('ticket.status_changed', {
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
        old_status: ticket.status,
        new_status: statusDto.status,
        changed_by_user_id: userId,
      });

      return { success: true, data: updated };
    } catch (error) {
      this.logger.error(`Error updating ticket status: ${error.message}`);
      throw error;
    }
  }

  async close(
    ticketId: number,
    closeDto: CloseTicketDto,
    userId: number,
  ) {
    try {
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: ticketId },
      });

      if (!ticket) {
        throw new NotFoundException('Ticket not found');
      }

      const resolutionTime = this.calculateResolutionTime(ticket.created_at);

      const closed = await this.prisma.support_tickets.update({
        where: { id: ticketId },
        data: {
          status: ticket_status_enum.CLOSED,
          resolution_summary: closeDto.resolution_summary,
          customer_satisfied: closeDto.customer_satisfied,
          resolution_time_minutes: resolutionTime,
          closed_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Create status history
      await this.prisma.support_status_history.create({
        data: {
          ticket_id: ticketId,
          old_status: ticket.status,
          new_status: ticket_status_enum.CLOSED,
          change_reason: 'Ticket closed',
          change_notes: closeDto.resolution_summary,
          changed_by_user_id: userId,
          created_at: new Date(),
        },
      });

      // Emit event
      this.eventEmitter.emit('ticket.closed', {
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
        resolution_summary: closeDto.resolution_summary,
        customer_satisfied: closeDto.customer_satisfied,
      });

      return { success: true, data: closed };
    } catch (error) {
      this.logger.error(`Error closing ticket: ${error.message}`);
      throw error;
    }
  }

  async reopen(ticketId: number, userId: number) {
    try {
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: ticketId },
      });

      if (!ticket) {
        throw new NotFoundException('Ticket not found');
      }

      const reopened = await this.prisma.support_tickets.update({
        where: { id: ticketId },
        data: {
          status: ticket_status_enum.REOPENED,
          updated_at: new Date(),
        },
      });

      // Create status history
      await this.prisma.support_status_history.create({
        data: {
          ticket_id: ticketId,
          old_status: ticket.status,
          new_status: ticket_status_enum.REOPENED,
          change_reason: 'Ticket reopened by user',
          changed_by_user_id: userId,
          created_at: new Date(),
        },
      });

      return { success: true, data: reopened };
    } catch (error) {
      this.logger.error(`Error reopening ticket: ${error.message}`);
      throw error;
    }
  }

  async getStats(organizationId: number, storeId?: number) {
    try {
      const where: any = { organization_id: organizationId };
      if (storeId) {
        where.store_id = storeId;
      }

      const [
        total,
        byStatus,
        byPriority,
        byCategory,
        overdue,
        avgResolutionTime,
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
            status: { notIn: [ticket_status_enum.RESOLVED, ticket_status_enum.CLOSED] },
          },
        }),

        this.prisma.support_tickets.aggregate({
          where: {
            ...where,
            resolution_time_minutes: { not: null },
          },
          _avg: {
            resolution_time_minutes: true,
          },
        }),
      ]);

      return {
        success: true,
        data: {
          total,
          by_status: byStatus.reduce((acc: any, item) => {
            acc[item.status] = item._count;
            return acc;
          }, {}),
          by_priority: byPriority.reduce((acc: any, item) => {
            acc[item.priority] = item._count;
            return acc;
          }, {}),
          by_category: byCategory.reduce((acc: any, item) => {
            acc[item.category] = item._count;
            return acc;
          }, {}),
          overdue,
          avg_resolution_time: avgResolutionTime._avg.resolution_time_minutes,
        },
      };
    } catch (error) {
      this.logger.error(`Error fetching ticket stats: ${error.message}`);
      throw error;
    }
  }

  // Private helper methods

  private async generateTicketNumber(organizationId: number): Promise<string> {
    const prefix = 'TKT';
    const count = await this.prisma.support_tickets.count({
      where: { organization_id: organizationId },
    });
    // Include organization_id to ensure global uniqueness
    return `${prefix}${organizationId}${String(count + 1).padStart(4, '0')}`;
  }

  private calculateSlaDeadline(priority: ticket_priority_enum): Date {
    const slaMinutes: Record<ticket_priority_enum, number> = {
      [ticket_priority_enum.P0]: 60,
      [ticket_priority_enum.P1]: 240,
      [ticket_priority_enum.P2]: 480,
      [ticket_priority_enum.P3]: 1440,
      [ticket_priority_enum.P4]: 2880,
    };

    const minutes = slaMinutes[priority] || 1440;
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  private calculateResolutionTime(createdAt: Date | null): number | null {
    if (!createdAt) return null;
    const created = new Date(createdAt).getTime();
    const now = Date.now();
    return Math.round((now - created) / (1000 * 60));
  }

  private async handleAttachments(
    ticketId: number,
    organization: { id: number; slug: string },
    attachments: Array<{
      base64_data: string;
      file_name: string;
      mime_type: string;
      description?: string;
    }>,
    uploadedBy: number,
  ): Promise<void> {
    const basePath = this.s3PathHelper.buildSupportPath(organization, ticketId);

    for (const attachment of attachments) {
      try {
        const fileName = `${Date.now()}-${attachment.file_name}`;
        const s3Key = `${basePath}/${ticketId}/${fileName}`;

        const uploadResult = await this.s3Service.uploadBase64(
          attachment.base64_data,
          s3Key,
          attachment.mime_type,
          { generateThumbnail: attachment.mime_type.startsWith('image/') },
        );

        // Get file size from base64
        const buffer = Buffer.from(attachment.base64_data.split(',')[1] || attachment.base64_data, 'base64');
        const fileSize = buffer.length;

        // Determine file type
        const fileType = attachment.mime_type.startsWith('image/') ? 'IMAGE' : 'DOCUMENT';

        // Save attachment record (only store keys, URLs are generated on demand)
        await this.prisma.support_attachments.create({
          data: {
            ticket_id: ticketId,
            file_name: attachment.file_name,
            file_key: uploadResult.key,
            file_size: fileSize,
            file_type: fileType,
            mime_type: attachment.mime_type,
            thumbnail_key: uploadResult.thumbKey,
            uploaded_by_user_id: uploadedBy,
            description: attachment.description,
            created_at: new Date(),
          },
        });

        this.logger.log(`Attachment uploaded successfully: ${fileName}`);
      } catch (error) {
        this.logger.error(`Error uploading attachment: ${error.message}`);
        throw error;
      }
    }
  }
}
