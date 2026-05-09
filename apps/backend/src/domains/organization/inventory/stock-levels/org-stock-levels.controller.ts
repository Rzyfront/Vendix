import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { SkipSubscriptionGate } from '../../../store/subscriptions/decorators/skip-subscription-gate.decorator';

import { OrgStockLevelsService } from './org-stock-levels.service';
import { OrgStockLevelQueryDto } from './dto/org-stock-level-query.dto';

/**
 * `/api/organization/inventory/stock-levels`
 *
 * Read-only org-wide stock-levels. Mutations are not exposed here; stock
 * mutations for ORG_ADMIN flow through `/organization/inventory/transfers`
 * (already validated by OperatingScopeService).
 *
 * Permissions reuse the store-side `inventory:read` namespace because the
 * frontend admin panel currently keys both flows on it.
 */
@Controller('organization/inventory/stock-levels')
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
export class OrgStockLevelsController {
  constructor(
    private readonly stockLevels: OrgStockLevelsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:inventory:stock_levels:read')
  async findAll(@Query() query: OrgStockLevelQueryDto) {
    const result = await this.stockLevels.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Niveles de stock obtenidos exitosamente',
    );
  }

  @Get('alerts')
  @Permissions('store:inventory:stock_levels:read')
  async getStockAlerts(@Query() query: OrgStockLevelQueryDto) {
    const result = await this.stockLevels.getStockAlerts(query);
    return this.responseService.success(
      result,
      'Alertas de stock obtenidas exitosamente',
    );
  }

  @Get('product/:productId')
  @Permissions('store:inventory:stock_levels:read')
  async findByProduct(
    @Param('productId') productId: string,
    @Query() query: OrgStockLevelQueryDto,
  ) {
    const result = await this.stockLevels.findByProduct(+productId, query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Niveles de stock del producto obtenidos exitosamente',
    );
  }

  @Get('location/:locationId')
  @Permissions('store:inventory:stock_levels:read')
  async findByLocation(
    @Param('locationId') locationId: string,
    @Query() query: OrgStockLevelQueryDto,
  ) {
    const result = await this.stockLevels.findByLocation(+locationId, query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Niveles de stock de la ubicación obtenidos exitosamente',
    );
  }

  @Get(':id')
  @Permissions('store:inventory:stock_levels:read')
  async findOne(@Param('id') id: string) {
    const data = await this.stockLevels.findOne(+id);
    return this.responseService.success(data, 'Nivel de stock obtenido');
  }
}
