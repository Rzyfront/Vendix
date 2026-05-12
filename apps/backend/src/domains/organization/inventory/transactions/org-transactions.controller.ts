import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { SkipSubscriptionGate } from '../../../store/subscriptions/decorators/skip-subscription-gate.decorator';

import { OrgTransactionsService } from './org-transactions.service';
import { QueryOrgTransactionsDto } from './dto/query-org-transactions.dto';

/**
 * `/api/organization/inventory/transactions` — read-only org-level inventory
 * transactions ledger across every store of the organization, with optional
 * `store_id` breakdown filter. Mirrors the read-only pattern used by
 * `/organization/inventory/movements`.
 *
 * Permission `organization:inventory:transactions:read` is wired here ahead of
 * its seed (P2 permissions seed work).
 */
@Controller('organization/inventory/transactions')
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
export class OrgTransactionsController {
  constructor(
    private readonly transactions: OrgTransactionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('organization:inventory:transactions:read')
  async findAll(@Query() query: QueryOrgTransactionsDto) {
    const result = await this.transactions.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Transacciones obtenidas exitosamente',
    );
  }

  @Get('product/:productId')
  @Permissions('organization:inventory:transactions:read')
  async findByProduct(
    @Param('productId') productId: string,
    @Query() query: QueryOrgTransactionsDto,
  ) {
    const result = await this.transactions.findByProduct(+productId, query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Transacciones del producto obtenidas exitosamente',
    );
  }

  @Get('user/:userId')
  @Permissions('organization:inventory:transactions:read')
  async findByUser(
    @Param('userId') userId: string,
    @Query() query: QueryOrgTransactionsDto,
  ) {
    const result = await this.transactions.findByUser(+userId, query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Transacciones del usuario obtenidas exitosamente',
    );
  }

  @Get(':id')
  @Permissions('organization:inventory:transactions:read')
  async findOne(@Param('id') id: string) {
    const data = await this.transactions.findOne(+id);
    return this.responseService.success(data, 'Transacción obtenida');
  }
}
