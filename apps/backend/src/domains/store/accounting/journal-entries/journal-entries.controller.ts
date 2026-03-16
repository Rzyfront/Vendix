import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntryFlowService } from './journal-entry-flow.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { QueryJournalEntryDto } from './dto/query-journal-entry.dto';

@Controller('store/accounting/journal-entries')
@UseGuards(PermissionsGuard)
export class JournalEntriesController {
  constructor(
    private readonly journal_entries_service: JournalEntriesService,
    private readonly journal_entry_flow_service: JournalEntryFlowService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:accounting:journal_entries:read')
  async findAll(@Query() query_dto: QueryJournalEntryDto) {
    const result = await this.journal_entries_service.findAll(query_dto);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Get(':id')
  @Permissions('store:accounting:journal_entries:read')
  async findOne(@Param('id') id: string) {
    const result = await this.journal_entries_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:accounting:journal_entries:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateJournalEntryDto) {
    const result = await this.journal_entries_service.create(create_dto);
    return this.response_service.success(result, 'Journal entry created successfully');
  }

  @Put(':id')
  @Permissions('store:accounting:journal_entries:update')
  async update(
    @Param('id') id: string,
    @Body() update_dto: UpdateJournalEntryDto,
  ) {
    const result = await this.journal_entries_service.update(+id, update_dto);
    return this.response_service.success(result, 'Journal entry updated successfully');
  }

  @Patch(':id/post')
  @Permissions('store:accounting:journal_entries:post')
  @HttpCode(HttpStatus.OK)
  async postEntry(@Param('id') id: string) {
    const result = await this.journal_entry_flow_service.post(+id);
    return this.response_service.success(result, 'Journal entry posted successfully');
  }

  @Patch(':id/void')
  @Permissions('store:accounting:journal_entries:void')
  @HttpCode(HttpStatus.OK)
  async voidEntry(@Param('id') id: string) {
    const result = await this.journal_entry_flow_service.void(+id);
    return this.response_service.success(result, 'Journal entry voided successfully');
  }

  @Delete(':id')
  @Permissions('store:accounting:journal_entries:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.journal_entries_service.remove(+id);
    return this.response_service.success(null, 'Journal entry deleted successfully');
  }
}
