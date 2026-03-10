import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { RequestContextService } from '../../../common/context/request-context.service';

@ApiTags('Support Comments')
@Controller('support/comments')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new comment on a ticket' })
  @ApiResponse({ status: 201, description: 'Comment created successfully' })
  async create(
    @Body() createCommentDto: CreateCommentDto,
  ) {
    const userId = RequestContextService.getUserId();

    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }

    return this.commentsService.create(
      createCommentDto.ticket_id,
      userId,
      createCommentDto,
    );
  }

  @Get('ticket/:ticketId')
  @ApiOperation({ summary: 'Get all comments for a ticket' })
  @ApiResponse({ status: 200, description: 'Comments retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Authentication required' })
  async findByTicket(@Param('ticketId') ticketId: string) {
    const userId = RequestContextService.getUserId();
    const organizationId = RequestContextService.getOrganizationId();

    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }

    if (!organizationId) {
      return { success: false, message: 'Organization context required' };
    }

    return this.commentsService.findByTicket(+ticketId, organizationId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a comment' })
  @ApiResponse({ status: 200, description: 'Comment deleted successfully' })
  async delete(@Param('id') id: string) {
    const userId = RequestContextService.getUserId();
    const organizationId = RequestContextService.getOrganizationId();

    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }

    if (!organizationId) {
      return { success: false, message: 'Organization context required' };
    }

    return this.commentsService.delete(+id, organizationId);
  }
}
