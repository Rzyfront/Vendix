import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { SkipSubscriptionGate } from '../../../store/subscriptions/decorators/skip-subscription-gate.decorator';

import { OrgMovementsService } from './org-movements.service';
import { OrgMovementQueryDto } from './dto/org-movement-query.dto';

/**
 * `/api/organization/inventory/movements` — read-only consolidated movements
 * across every store of the organization, with optional `store_id` breakdown
 * filter.
 */
@Controller('organization/inventory/movements')
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
export class OrgMovementsController {
  constructor(
    private readonly movements: OrgMovementsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:inventory:movements:read')
  async findAll(@Query() query: OrgMovementQueryDto) {
    const result = await this.movements.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Movimientos obtenidos exitosamente',
    );
  }

  @Get('product/:productId')
  @Permissions('store:inventory:movements:read')
  async findByProduct(
    @Param('productId') productId: string,
    @Query() query: OrgMovementQueryDto,
  ) {
    const result = await this.movements.findByProduct(+productId, query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Movimientos del producto obtenidos exitosamente',
    );
  }

  @Get('location/:locationId')
  @Permissions('store:inventory:movements:read')
  async findByLocation(
    @Param('locationId') locationId: string,
    @Query() query: OrgMovementQueryDto,
  ) {
    const result = await this.movements.findByLocation(+locationId, query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Movimientos de la ubicación obtenidos exitosamente',
    );
  }

  @Get('user/:userId')
  @Permissions('store:inventory:movements:read')
  async findByUser(
    @Param('userId') userId: string,
    @Query() query: OrgMovementQueryDto,
  ) {
    const result = await this.movements.findByUser(+userId, query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Movimientos del usuario obtenidos exitosamente',
    );
  }

  @Get(':id')
  @Permissions('store:inventory:movements:read')
  async findOne(@Param('id') id: string) {
    const data = await this.movements.findOne(+id);
    return this.responseService.success(data, 'Movimiento obtenido');
  }
}
