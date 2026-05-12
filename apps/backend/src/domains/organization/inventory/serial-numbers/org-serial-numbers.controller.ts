import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { SkipSubscriptionGate } from '../../../store/subscriptions/decorators/skip-subscription-gate.decorator';

import { OrgSerialNumbersService } from './org-serial-numbers.service';
import { ListOrgSerialNumbersDto } from './dto/list-org-serial-numbers.dto';

/**
 * `/api/organization/inventory/serial-numbers` — read-only consolidated
 * listing of `inventory_serial_numbers` across every store of the
 * organization, with optional `store_id` breakdown.
 *
 * Mutations are intentionally not exposed here: serial numbers are still
 * created/edited via the store-scoped flows (batches / receptions /
 * adjustments).
 */
@Controller('organization/inventory/serial-numbers')
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
export class OrgSerialNumbersController {
  constructor(
    private readonly serialNumbers: OrgSerialNumbersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('organization:inventory:serial-numbers:read')
  async findAll(@Query() query: ListOrgSerialNumbersDto) {
    const result = await this.serialNumbers.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Números de serie obtenidos exitosamente',
    );
  }

  @Get(':id')
  @Permissions('organization:inventory:serial-numbers:read')
  async findOne(@Param('id') id: string) {
    const data = await this.serialNumbers.findOne(+id);
    return this.responseService.success(data, 'Número de serie obtenido');
  }
}
