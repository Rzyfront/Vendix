import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SuperadminSupportService } from './support.service';
import { SuperadminTicketQueryDto } from './dto/superadmin-ticket-query.dto';
import { AssignTicketDto } from '../../support/tickets/dto/ticket-assignment.dto';
import { UpdateTicketStatusDto, CloseTicketDto } from '../../support/tickets/dto/ticket-status.dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { RequestContextService } from '../../../common/context/request-context.service';
import { ResponseService } from '../../../common/responses/response.service';

/**
 * Superadmin Support Controller
 * Provides global access to manage all support tickets across all organizations
 *
 * All endpoints require SUPER_ADMIN role
 */
@ApiTags('Superadmin Support')
@Controller('superadmin/support')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SuperadminSupportController {
  constructor(
    private readonly supportService: SuperadminSupportService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Get all tickets across all organizations
   * Can be filtered by organization, store, status, priority, etc.
   */
  @Get('tickets')
  @ApiOperation({ summary: 'Get all support tickets (global)' })
  @ApiResponse({ status: 200, description: 'Tickets retrieved successfully' })
  async findAll(@Query() query: SuperadminTicketQueryDto) {
    const result = await this.supportService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Tickets retrieved successfully',
    );
  }

  /**
   * Get global statistics across all organizations
   */
  @Get('tickets/stats')
  @ApiOperation({ summary: 'Get global support statistics' })
  @ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
  async getGlobalStats() {
    const result = await this.supportService.getGlobalStats();
    return this.responseService.success(
      result.data,
      'Global statistics retrieved successfully',
    );
  }

  /**
   * Get a single ticket by ID (any organization)
   */
  @Get('tickets/:id')
  @ApiOperation({ summary: 'Get a ticket by ID (global)' })
  @ApiResponse({ status: 200, description: 'Ticket retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async findOne(@Param('id') id: string) {
    const result = await this.supportService.findOne(+id);
    return this.responseService.success(result.data, 'Ticket retrieved successfully');
  }

  /**
   * Update ticket (any organization)
   */
  @Patch('tickets/:id')
  @ApiOperation({ summary: 'Update a ticket (global)' })
  @ApiResponse({ status: 200, description: 'Ticket updated successfully' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async update(
    @Param('id') id: string,
    @Body() updateTicketDto: any,
  ) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      return this.responseService.error('User authentication required');
    }
    const result = await this.supportService.update(+id, updateTicketDto, userId);
    return this.responseService.updated(result.data, 'Ticket updated successfully');
  }

  /**
   * Assign ticket to a user
   */
  @Patch('tickets/:id/assign')
  @ApiOperation({ summary: 'Assign a ticket to a user (global)' })
  @ApiResponse({ status: 200, description: 'Ticket assigned successfully' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async assign(
    @Param('id') id: string,
    @Body() assignDto: AssignTicketDto,
  ) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      return this.responseService.error('User authentication required');
    }
    const result = await this.supportService.assign(+id, assignDto, userId);
    return this.responseService.success(result.data, 'Ticket assigned successfully');
  }

  /**
   * Update ticket status
   */
  @Patch('tickets/:id/status')
  @ApiOperation({ summary: 'Update ticket status (global)' })
  @ApiResponse({ status: 200, description: 'Ticket status updated successfully' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async updateStatus(
    @Param('id') id: string,
    @Body() statusDto: UpdateTicketStatusDto,
  ) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      return this.responseService.error('User authentication required');
    }
    const result = await this.supportService.updateStatus(+id, statusDto, userId);
    return this.responseService.success(result.data, 'Ticket status updated successfully');
  }

  /**
   * Close a ticket
   */
  @Patch('tickets/:id/close')
  @ApiOperation({ summary: 'Close a ticket (global)' })
  @ApiResponse({ status: 200, description: 'Ticket closed successfully' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async close(
    @Param('id') id: string,
    @Body() closeDto: CloseTicketDto,
  ) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      return this.responseService.error('User authentication required');
    }
    const result = await this.supportService.close(+id, closeDto, userId);
    return this.responseService.success(result.data, 'Ticket closed successfully');
  }

  /**
   * Reopen a closed ticket
   */
  @Patch('tickets/:id/reopen')
  @ApiOperation({ summary: 'Reopen a closed ticket (global)' })
  @ApiResponse({ status: 200, description: 'Ticket reopened successfully' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async reopen(@Param('id') id: string) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      return this.responseService.error('User authentication required');
    }
    const result = await this.supportService.reopen(+id, userId);
    return this.responseService.success(result.data, 'Ticket reopened successfully');
  }

  /**
   * Get comments for a ticket
   */
  @Get('tickets/:id/comments')
  @ApiOperation({ summary: 'Get all comments for a ticket (global)' })
  @ApiResponse({ status: 200, description: 'Comments retrieved successfully' })
  async getComments(@Param('id') id: string) {
    const result = await this.supportService.getComments(+id);
    return this.responseService.success(result.data, 'Comments retrieved successfully');
  }

  /**
   * Add a comment to a ticket
   */
  @Post('tickets/:id/comments')
  @ApiOperation({ summary: 'Add a comment to a ticket (global)' })
  @ApiResponse({ status: 201, description: 'Comment added successfully' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async addComment(
    @Param('id') id: string,
    @Body() body: { content: string; is_internal?: boolean },
  ) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      return this.responseService.error('User authentication required');
    }
    const result = await this.supportService.addComment(
      +id,
      userId,
      body.content,
      body.is_internal || false,
    );
    return this.responseService.created(result.data, 'Comment added successfully');
  }
}
