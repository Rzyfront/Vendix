import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { CustomerHistoryService } from './customer-history.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';

@Controller('store/customers/:customerId/history')
@UseGuards(PermissionsGuard)
export class CustomerHistoryController {
  constructor(
    private readonly service: CustomerHistoryService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:customers:read')
  async getTimeline(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.service.getTimeline(
      customerId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
    return this.responseService.success(result);
  }

  @Get('summary')
  @Permissions('store:customers:read')
  async getSummary(@Param('customerId', ParseIntPipe) customerId: number) {
    const result = await this.service.getSummaryNotes(customerId);
    return this.responseService.success(result);
  }

  @Get('context')
  @Permissions('store:customers:read')
  async getFullContext(@Param('customerId', ParseIntPipe) customerId: number) {
    const result = await this.service.getFullContext(customerId);
    return this.responseService.success(result);
  }

  @Get(':bookingId')
  @Permissions('store:customers:read')
  async getBookingDetail(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Param('bookingId', ParseIntPipe) bookingId: number,
  ) {
    const result = await this.service.getBookingDetail(customerId, bookingId);
    return this.responseService.success(result);
  }

  @Post(':bookingId/notes')
  @Permissions('store:customers:update')
  async addNote(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Param('bookingId', ParseIntPipe) bookingId: number,
    @Body() body: { note_key: string; note_value: string },
  ) {
    const context = RequestContextService.getContext();
    const result = await this.service.addNote(
      customerId,
      bookingId,
      body.note_key,
      body.note_value,
      context?.user_id,
    );
    return this.responseService.success(result, 'Nota agregada correctamente');
  }

  @Patch('notes/:noteId/toggle-summary')
  @Permissions('store:customers:update')
  async toggleNoteSummary(@Param('noteId', ParseIntPipe) noteId: number) {
    const result = await this.service.toggleNoteSummary(noteId);
    return this.responseService.success(result);
  }
}
