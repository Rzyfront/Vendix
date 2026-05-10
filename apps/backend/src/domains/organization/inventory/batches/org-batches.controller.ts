import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { SkipSubscriptionGate } from '../../../store/subscriptions/decorators/skip-subscription-gate.decorator';

import { OrgBatchesService } from './org-batches.service';
import { ListOrgBatchesDto } from './dto/list-org-batches.dto';

/**
 * `/api/organization/inventory/batches` — read-only consolidated lots view
 * across the entire organization, with expiration filtering.
 */
@Controller('organization/inventory/batches')
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
export class OrgBatchesController {
  constructor(
    private readonly batches: OrgBatchesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('organization:inventory:batches:read')
  async list(@Query() query: ListOrgBatchesDto) {
    const result = await this.batches.list(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Lotes obtenidos exitosamente',
    );
  }

  @Get('expiring-soon')
  @Permissions('organization:inventory:batches:read')
  async expiringSoon(@Query() query: ListOrgBatchesDto) {
    const result = await this.batches.expiringSoon(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Lotes próximos a vencer',
    );
  }

  @Get(':id')
  @Permissions('organization:inventory:batches:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.batches.findOne(id);
    return this.responseService.success(data, 'Lote obtenido');
  }
}
