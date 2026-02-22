import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { AssignTicketDto } from './dto/ticket-assignment.dto';
import { UpdateTicketStatusDto, CloseTicketDto } from './dto/ticket-status.dto';
import { RequestContextService } from '../../../common/context/request-context.service';

@ApiTags('Support Tickets')
@Controller('support/tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new support ticket' })
  @ApiResponse({ status: 201, description: 'Ticket created successfully' })
  async create(@Body() createTicketDto: CreateTicketDto) {
    const organizationId = RequestContextService.getOrganizationId();
    const storeId = RequestContextService.getStoreId();
    const userId = RequestContextService.getUserId();

    if (!organizationId || !userId) {
      return { success: false, message: 'Authentication required' };
    }

    return this.ticketsService.create(
      organizationId,
      storeId,
      userId,
      createTicketDto,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get all support tickets with filters' })
  @ApiResponse({ status: 200, description: 'Tickets retrieved successfully' })
  async findAll(@Query() query: TicketQueryDto) {
    const organizationId = RequestContextService.getOrganizationId();
    const storeId = RequestContextService.getStoreId();

    if (!organizationId) {
      return { success: false, message: 'Authentication required' };
    }

    return this.ticketsService.findAll(organizationId, storeId, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get support tickets statistics' })
  @ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
  async getStats() {
    const organizationId = RequestContextService.getOrganizationId();
    const storeId = RequestContextService.getStoreId();

    if (!organizationId) {
      return { success: false, message: 'Authentication required' };
    }

    return this.ticketsService.getStats(organizationId, storeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single support ticket by ID' })
  @ApiResponse({ status: 200, description: 'Ticket retrieved successfully' })
  async findOne(@Param('id') id: string) {
    return this.ticketsService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a support ticket' })
  @ApiResponse({ status: 200, description: 'Ticket updated successfully' })
  async update(
    @Param('id') id: string,
    @Body() updateTicketDto: UpdateTicketDto,
  ) {
    const userId = RequestContextService.getUserId();

    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }

    return this.ticketsService.update(+id, updateTicketDto, userId);
  }

  @Patch(':id/assign')
  @ApiOperation({ summary: 'Assign a ticket to a user' })
  @ApiResponse({ status: 200, description: 'Ticket assigned successfully' })
  async assign(
    @Param('id') id: string,
    @Body() assignDto: AssignTicketDto,
  ) {
    const userId = RequestContextService.getUserId();

    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }

    return this.ticketsService.assign(+id, assignDto, userId);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update ticket status' })
  @ApiResponse({ status: 200, description: 'Ticket status updated successfully' })
  async updateStatus(
    @Param('id') id: string,
    @Body() statusDto: UpdateTicketStatusDto,
  ) {
    const userId = RequestContextService.getUserId();

    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }

    return this.ticketsService.updateStatus(+id, statusDto, userId);
  }

  @Patch(':id/close')
  @ApiOperation({ summary: 'Close a ticket' })
  @ApiResponse({ status: 200, description: 'Ticket closed successfully' })
  async close(
    @Param('id') id: string,
    @Body() closeDto: CloseTicketDto,
  ) {
    const userId = RequestContextService.getUserId();

    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }

    return this.ticketsService.close(+id, closeDto, userId);
  }

  @Patch(':id/reopen')
  @ApiOperation({ summary: 'Reopen a closed ticket' })
  @ApiResponse({ status: 200, description: 'Ticket reopened successfully' })
  async reopen(@Param('id') id: string) {
    const userId = RequestContextService.getUserId();

    if (!userId) {
      return { success: false, message: 'Authentication required' };
    }

    return this.ticketsService.reopen(+id, userId);
  }
}
