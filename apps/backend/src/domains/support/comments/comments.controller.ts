import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { RequestContextService } from '../../../common/context/request-context.service';

@ApiTags('Support Comments')
@Controller('support/comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new comment on a ticket' })
  @ApiResponse({ status: 201, description: 'Comment created successfully' })
  async create(
    @Body() createCommentDto: CreateCommentDto & { ticket_id: number },
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
  async findByTicket(@Param('ticketId') ticketId: string) {
    return this.commentsService.findByTicket(+ticketId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a comment' })
  @ApiResponse({ status: 200, description: 'Comment deleted successfully' })
  async delete(@Param('id') id: string) {
    const userId = RequestContextService.getUserId();

    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }

    return this.commentsService.delete(+id, userId);
  }
}
