import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../../common/guards/module-flow.guard';
import { ResponseService } from '../../../../common/responses/response.service';

import { OrgJournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto } from '../../../store/accounting/journal-entries/dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from '../../../store/accounting/journal-entries/dto/update-journal-entry.dto';
import { QueryJournalEntryDto } from '../../../store/accounting/journal-entries/dto/query-journal-entry.dto';

/**
 * Org-native journal entries controller. Reads are consolidated across the
 * org (with optional `?store_id` breakdown); writes pin a target store via
 * `runWithStoreContext` and delegate to the existing store services.
 */
@Controller('organization/accounting/journal-entries')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class OrgJournalEntriesController {
  constructor(
    private readonly journalEntries: OrgJournalEntriesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('organization:accounting:journal_entries:read')
  async findAll(@Query() query: QueryJournalEntryDto) {
    const result = await this.journalEntries.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Get(':id')
  @Permissions('organization:accounting:journal_entries:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.journalEntries.findOne(id);
    return this.responseService.success(result);
  }

  @Post()
  @Permissions('organization:accounting:journal_entries:create')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateJournalEntryDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.journalEntries.create(dto, store_id);
    return this.responseService.success(
      result,
      'Journal entry created successfully',
    );
  }

  @Put(':id')
  @Permissions('organization:accounting:journal_entries:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateJournalEntryDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.journalEntries.update(id, dto, store_id);
    return this.responseService.success(
      result,
      'Journal entry updated successfully',
    );
  }

  @Patch(':id/post')
  @Permissions('organization:accounting:journal_entries:post')
  @HttpCode(HttpStatus.OK)
  async postEntry(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.journalEntries.post(id, store_id);
    return this.responseService.success(
      result,
      'Journal entry posted successfully',
    );
  }

  @Patch(':id/void')
  @Permissions('organization:accounting:journal_entries:void')
  @HttpCode(HttpStatus.OK)
  async voidEntry(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.journalEntries.voidEntry(id, store_id);
    return this.responseService.success(
      result,
      'Journal entry voided successfully',
    );
  }

  @Delete(':id')
  @Permissions('organization:accounting:journal_entries:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    await this.journalEntries.remove(id, store_id);
    return this.responseService.success(
      null,
      'Journal entry deleted successfully',
    );
  }
}
