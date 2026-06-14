import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { SplitOrderService } from './split-order.service';
import { SplitByItemsDto, SplitByAmountDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/**
 * SplitOrderController (Restaurant Suite — Fase E)
 *
 * REST seam for the financial split of a draft (open check) order.
 * Note: split is FINANCIAL ONLY — the inventory was already consumed
 * at fire-to-kitchen (Fase D). Sub-orders propagate the
 * `inventory_consumed_at_fire` flag to the new lines so the payment
 * path does not re-consume.
 *
 *   POST /api/store/orders/:orderId/split-by-items   groups = N lists of item_ids
 *   POST /api/store/orders/:orderId/split-by-amount  mode = 'equal' | 'custom'
 *
 * Permission policy:
 *   - Both routes → store:table_sessions:update (operators who can
 *     manage the open check can also split it).
 */
@Controller('store/orders')
@UseGuards(PermissionsGuard)
export class SplitOrderController {
  constructor(
    private readonly splitOrderService: SplitOrderService,
    private readonly responseService: ResponseService,
  ) {}

  @Post(':orderId/split-by-items')
  @Permissions('store:table_sessions:update')
  async splitByItems(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: SplitByItemsDto,
  ) {
    try {
      const result = await this.splitOrderService.splitByItems(
        orderId,
        dto,
      );
      return this.responseService.created(
        result,
        `Cuenta dividida en ${result.sub_orders.length} sub-órdenes`,
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al dividir la cuenta',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post(':orderId/split-by-amount')
  @Permissions('store:table_sessions:update')
  async splitByAmount(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: SplitByAmountDto,
  ) {
    try {
      const result = await this.splitOrderService.splitByAmount(
        orderId,
        dto,
      );
      return this.responseService.created(
        result,
        `Cuenta dividida en ${result.sub_orders.length} sub-órdenes`,
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al dividir la cuenta',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }
}
