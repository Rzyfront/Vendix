import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { SuperadminTicketQueryDto } from './dto/superadmin-ticket-query.dto';
import { UpdateTicketStatusDto, CloseTicketDto } from '../../support/tickets/dto/ticket-status.dto';
import { AssignTicketDto } from '../../support/tickets/dto/ticket-assignment.dto';
import {
  ticket_status_enum,
  ticket_priority_enum,
} from '@prisma/client';
import { S3Service } from '@common/services/s3.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Superadmin Support Service
 * Provides global access to all support tickets across all organizations
 */
@Injectable()
export class SuperadminSupportService {
  private readonly logger = new Logger(SuperadminSupportService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly s3Service: S3Service,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Get all tickets across all organizations with filters
   */
  async findAll(query: SuperadminTicketQueryDto) {
    try {
      const where: any = {};

      // Apply organization filter if provided
      if (query.organization_id) {
        where.organization_id = query.organization_id;
      }

      // Apply store filter if provided
      if (query.store_id) {
        where.store_id = query.store_id;
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
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            store: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
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

  /**
   * Get a single ticket by ID (any organization)
   */
  async findOne(ticketId: number) {
    try {
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: ticketId },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          store: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
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

  /**
   * Update ticket (any organization)
   */
  async update(ticketId: number, updateTicketDto: any, userId: number) {
    try {
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: ticketId },
      });

      if (!ticket) {
        throw new NotFoundException('Ticket not found');
      }

      const updated = await this.prisma.support_tickets.update({
        where: { id: ticketId },
        data: {
          ...updateTicketDto,
          updated_at: new Date(),
        },
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

  /**
   * Assign ticket to a user
   */
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

  /**
   * Update ticket status
   */
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

  /**
   * Close a ticket
   */
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

  /**
   * Reopen a closed ticket
   */
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
          change_reason: 'Ticket reopened by superadmin',
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

  /**
   * Get global statistics across all organizations
   */
  async getGlobalStats() {
    try {
      const [
        total,
        byStatus,
        byPriority,
        byCategory,
        overdue,
        avgResolutionTime,
        openTickets,
        resolved,
      ] = await Promise.all([
        this.prisma.support_tickets.count(),

        this.prisma.support_tickets.groupBy({
          by: ['status'],
          _count: true,
        }),

        this.prisma.support_tickets.groupBy({
          by: ['priority'],
          _count: true,
        }),

        this.prisma.support_tickets.groupBy({
          by: ['category'],
          _count: true,
        }),

        this.prisma.support_tickets.count({
          where: {
            sla_deadline: { lt: new Date() },
            status: { notIn: [ticket_status_enum.RESOLVED, ticket_status_enum.CLOSED] },
          },
        }),

        this.prisma.support_tickets.aggregate({
          where: {
            resolution_time_minutes: { not: null },
          },
          _avg: {
            resolution_time_minutes: true,
          },
        }),

        this.prisma.support_tickets.count({
          where: {
            status: {
              in: [ticket_status_enum.NEW, ticket_status_enum.OPEN, ticket_status_enum.IN_PROGRESS, ticket_status_enum.WAITING_RESPONSE],
            },
          },
        }),

        this.prisma.support_tickets.count({
          where: {
            status: ticket_status_enum.RESOLVED,
          },
        }),
      ]);

      return {
        success: true,
        data: {
          total,
          open_tickets: openTickets,
          resolved,
          pending: total - openTickets - resolved,
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
      this.logger.error(`Error fetching global ticket stats: ${error.message}`);
      throw error;
    }
  }

  /**
   * Add a comment to a ticket
   */
  async addComment(ticketId: number, userId: number, content: string, isInternal: boolean = false) {
    try {
      // Verify ticket exists
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          ticket_number: true,
          organization_id: true,
        },
      });

      if (!ticket) {
        throw new NotFoundException('Ticket not found');
      }

      // Get user info
      const user = await this.prisma.users.findUnique({
        where: { id: userId },
        select: { id: true, email: true, first_name: true, last_name: true },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Create comment
      const comment = await this.prisma.support_comments.create({
        data: {
          ticket_id: ticketId,
          content,
          is_internal: isInternal,
          author_id: userId,
          author_type: 'admin',
          author_name: `${user.first_name} ${user.last_name}`.trim(),
          author_email: user.email,
          created_at: new Date(),
          updated_at: new Date(),
        },
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
      });

      // Emit event
      this.eventEmitter.emit('ticket.comment_added', {
        ticket_id: ticketId,
        ticket_number: ticket.ticket_number,
        comment_id: comment.id,
        author_id: userId,
        is_internal: isInternal,
      });

      this.logger.log(`Comment created for ticket ${ticket.ticket_number} by superadmin`);
      return { success: true, data: comment };
    } catch (error) {
      this.logger.error(`Error creating comment: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all comments for a ticket
   */
  async getComments(ticketId: number) {
    try {
      const comments = await this.prisma.support_comments.findMany({
        where: { ticket_id: ticketId },
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
      });

      return { success: true, data: comments };
    } catch (error) {
      this.logger.error(`Error fetching comments: ${error.message}`);
      throw error;
    }
  }

  // Private helper methods

  private calculateResolutionTime(createdAt: Date | null): number | null {
    if (!createdAt) return null;
    const created = new Date(createdAt).getTime();
    const now = Date.now();
    return Math.round((now - created) / (1000 * 60));
  }
}
