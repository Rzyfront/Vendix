import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(ticketId: number, userId: number, createCommentDto: CreateCommentDto) {
    try {
      // Get ticket to verify it exists and get organization
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          organization_id: true,
          ticket_number: true,
          created_by_user_id: true,
          assigned_to_user_id: true,
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

      // Get organization for S3 path
      const organization = await this.prisma.organizations.findUnique({
        where: { id: ticket.organization_id },
        select: { id: true, slug: true },
      });

      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Handle attachments if any
      let attachmentKeys: string[] = [];
      if (createCommentDto.attachments && createCommentDto.attachments.length > 0) {
        attachmentKeys = await this.handleCommentAttachments(
          ticketId,
          organization,
          createCommentDto.attachments,
          userId,
        );
      }

      // Create comment
      const comment = await this.prisma.support_comments.create({
        data: {
          ticket_id: ticketId,
          content: createCommentDto.content,
          is_internal: createCommentDto.is_internal || false,
          author_id: userId,
          author_type: 'admin',
          author_name: `${user.first_name} ${user.last_name}`.trim(),
          author_email: user.email,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Emit event
      this.eventEmitter.emit('ticket.comment_added', {
        ticket_id: ticketId,
        ticket_number: ticket.ticket_number,
        comment_id: comment.id,
        author_id: userId,
        is_internal: createCommentDto.is_internal || false,
        organization_id: ticket.organization_id,
      });

      this.logger.log(`Comment created for ticket ${ticket.ticket_number}`);
      return { success: true, data: comment };
    } catch (error) {
      this.logger.error(`Error creating comment: ${error.message}`);
      throw error;
    }
  }

  async findByTicket(ticketId: number) {
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

  async delete(commentId: number, userId: number) {
    try {
      const comment = await this.prisma.support_comments.findUnique({
        where: { id: commentId },
      });

      if (!comment) {
        throw new NotFoundException('Comment not found');
      }

      // Only author or admin can delete
      if (comment.author_id !== userId) {
        // TODO: Add role check for admin
        throw new Error('You can only delete your own comments');
      }

      await this.prisma.support_comments.delete({
        where: { id: commentId },
      });

      return { success: true, message: 'Comment deleted successfully' };
    } catch (error) {
      this.logger.error(`Error deleting comment: ${error.message}`);
      throw error;
    }
  }

  private async handleCommentAttachments(
    ticketId: number,
    organization: { id: number; slug: string },
    attachments: Array<{
      base64_data: string;
      file_name: string;
      mime_type: string;
    }>,
    uploadedBy: number,
  ): Promise<string[]> {
    const basePath = this.s3PathHelper.buildSupportPath(organization, ticketId);
    const keys: string[] = [];

    for (const attachment of attachments) {
      try {
        const fileName = `comment-${Date.now()}-${attachment.file_name}`;
        const s3Key = `${basePath}/${ticketId}/comments/${fileName}`;

        const uploadResult = await this.s3Service.uploadBase64(
          attachment.base64_data,
          s3Key,
          attachment.mime_type,
          { generateThumbnail: attachment.mime_type.startsWith('image/') },
        );

        keys.push(uploadResult.key);
        this.logger.log(`Comment attachment uploaded: ${fileName}`);
      } catch (error) {
        this.logger.error(`Error uploading comment attachment: ${error.message}`);
        // Continue with other attachments
      }
    }

    return keys;
  }
}
