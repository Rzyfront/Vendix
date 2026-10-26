import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { OrderItemChangesService } from './order-item-changes.service';
import { OrderItemChangesDto } from './dto/order-item-changes.dto';

/**
 * QUI-650 — cambios por diferencia sobre las líneas de una orden.
 *
 * Mismo prefijo que `OrderFlowController` (`store/orders/:orderId/flow`) pero
 * rutas distintas: `POST items/changes[/preview]` no colisiona con
 * `PATCH items/:orderItemId/...` (otro verbo y otra cantidad de segmentos).
 * Sin try/catch: los errores suben al `AllExceptionsFilter`.
 */
@Controller('store/orders')
@UseGuards(PermissionsGuard)
export class OrderItemChangesController {
  constructor(
    private readonly orderItemChangesService: OrderItemChangesService,
    private readonly responseService: ResponseService,
  ) {}

  @Post(':orderId/flow/items/changes/preview')
  @Permissions('store:orders:update')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: OrderItemChangesDto,
  ) {
    const data = await this.orderItemChangesService.preview(orderId, dto);
    return this.responseService.success(
      data,
      'Vista previa de cambios calculada',
    );
  }

  @Post(':orderId/flow/items/changes')
  @Permissions('store:orders:update')
  @HttpCode(HttpStatus.OK)
  async apply(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: OrderItemChangesDto,
  ) {
    const data = await this.orderItemChangesService.apply(orderId, dto);
    return this.responseService.updated(data, 'Productos de la orden actualizados');
  }
}
