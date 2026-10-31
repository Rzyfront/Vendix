import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { CustomerCrmService } from './customer-crm.service';
import {
  CreateCrmCustomerNoteDto,
  CrmNotesQueryDto,
  CustomerCrmTimelineQueryDto,
  SetCustomerTagsDto,
  UpdateCrmCustomerNoteDto,
  UpdateCustomerCrmProfileDto,
} from './dto/customer-crm.dto';

/**
 * Customer 360 (PLAN-CRM §4.4).
 *
 *   GET   /store/customers/:customerId/crm/profile
 *   PATCH /store/customers/:customerId/crm/profile       owner needs crm_inbox:assign
 *   GET   /store/customers/:customerId/crm/timeline      ?types&before&limit
 *   PUT   /store/customers/:customerId/crm/tags          replaces the set
 *   GET   /store/customers/:customerId/crm/notes
 *   POST  /store/customers/:customerId/crm/notes
 *   PATCH /store/customers/:customerId/crm/notes/:noteId author or see-all
 */
@Controller('store/customers/:customerId/crm')
@UseGuards(PermissionsGuard)
export class CustomerCrmController {
  constructor(
    private readonly service: CustomerCrmService,
    private readonly response: ResponseService,
  ) {}

  @Get('profile')
  @Permissions('store:customers:read')
  async profile(@Param('customerId', ParseIntPipe) customerId: number) {
    return this.response.success(await this.service.getProfile(customerId));
  }

  @Patch('profile')
  @Permissions('store:customers:update')
  async updateProfile(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: UpdateCustomerCrmProfileDto,
  ) {
    return this.response.success(
      await this.service.updateProfile(customerId, dto),
      'Perfil CRM actualizado',
    );
  }

  @Get('timeline')
  @Permissions('store:customers:read')
  async timeline(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query() query: CustomerCrmTimelineQueryDto,
  ) {
    return this.response.success(
      await this.service.timeline(customerId, query),
    );
  }

  @Put('tags')
  @Permissions('store:customers:update')
  async setTags(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: SetCustomerTagsDto,
  ) {
    return this.response.success(
      await this.service.setTags(customerId, dto.tag_ids),
      'Etiquetas actualizadas',
    );
  }

  @Get('notes')
  @Permissions('store:customers:read')
  async notes(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query() query: CrmNotesQueryDto,
  ) {
    const { data, total, page, limit } = await this.service.listNotes(
      customerId,
      query,
    );
    return this.response.paginated(data, total, page, limit);
  }

  @Post('notes')
  @Permissions('store:customers:update')
  async createNote(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: CreateCrmCustomerNoteDto,
  ) {
    return this.response.success(
      await this.service.createNote(customerId, dto),
      'Nota guardada',
    );
  }

  @Patch('notes/:noteId')
  @Permissions('store:customers:update')
  async updateNote(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Param('noteId', ParseIntPipe) noteId: number,
    @Body() dto: UpdateCrmCustomerNoteDto,
  ) {
    return this.response.success(
      await this.service.updateNote(customerId, noteId, dto),
      'Nota actualizada',
    );
  }
}
