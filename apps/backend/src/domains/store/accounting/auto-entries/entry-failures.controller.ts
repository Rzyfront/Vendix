import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../../common/guards/module-flow.guard';
import { ResponseService } from '../../../../common/responses/response.service';
import { AccountingEntryFailureService } from './accounting-entry-failure.service';

/**
 * Observabilidad de asientos automáticos fallidos. Lista los fallos no
 * resueltos y permite re-encolar un reintento manual. Protegido con los mismos
 * permisos de journal_entries (los fallos son asientos que no llegaron a
 * cuajar), evitando sembrar permisos nuevos.
 */
@Controller('store/accounting/entry-failures')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class EntryFailuresController {
  constructor(
    private readonly failure_service: AccountingEntryFailureService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:accounting:journal_entries:read')
  async findUnresolved(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.failure_service.listUnresolved(
      page ? +page : 1,
      limit ? +limit : 20,
    );
    return this.response_service.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Post(':id/retry')
  @Permissions('store:accounting:journal_entries:update')
  async retry(@Param('id') id: string) {
    const failure = await this.failure_service.findOne(+id);
    if (!failure) {
      throw new NotFoundException(`Auto-entry failure #${id} not found`);
    }
    if (failure.resolved_at) {
      return this.response_service.success(
        failure,
        'Auto-entry failure already resolved',
      );
    }
    await this.failure_service.enqueueRetry(+id);
    return this.response_service.success(
      failure,
      'Auto-entry retry enqueued',
    );
  }
}
