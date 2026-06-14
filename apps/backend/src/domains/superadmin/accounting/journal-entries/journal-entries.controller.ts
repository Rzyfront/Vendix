import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { JournalEntriesService } from './journal-entries.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { QueryJournalEntryDto } from './dto/query-journal-entry.dto';

@Controller('super-admin/fiscal/accounting/journal-entries')
@UseGuards(PermissionsGuard)
export class JournalEntriesController {
  constructor(
    private readonly journal_entries_service: JournalEntriesService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('superadmin:fiscal:accounting:read')
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
  @Permissions('superadmin:fiscal:accounting:read')
  async findOne(@Param('id') id: string) {
    const result = await this.journal_entries_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('superadmin:fiscal:accounting:create')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() create_dto: CreateJournalEntryDto,
    @Req() req: any,
  ) {
    const user_id = (req?.user?.id as number | undefined) ?? null;
    const result = await this.journal_entries_service.create(
      create_dto,
      user_id,
    );
    return this.response_service.created(
      result,
      'Journal entry created successfully',
    );
  }
}
