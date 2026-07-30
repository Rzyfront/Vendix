import { PartialType } from '@nestjs/mapped-types';
import { CreateOrderDto } from './create-order.dto';
import {
  IsOptional,
  IsDateString,
  IsString,
  MaxLength,
  IsInt,
  IsEnum,
} from 'class-validator';
import { order_delivery_type_enum } from '@prisma/client';

/**
 * DTO for updating order metadata.
 * Note: Order state changes must be done through OrderFlowService endpoints:
 * - POST /store/orders/:id/flow/pay
 * - POST /store/orders/:id/flow/ship
 * - POST /store/orders/:id/flow/deliver
 * - POST /store/orders/:id/flow/confirm-delivery
 * - POST /store/orders/:id/flow/cancel
 * - POST /store/orders/:id/flow/refund
 *
 * QUI-557 — Esa nota describe la intención, no lo que la clase impone:
 * `PartialType(CreateOrderDto)` reexpone `state` y `payment_status`, y el
 * `whitelist` del ValidationPipe no puede filtrar un campo que el DTO declara.
 * No se quitan aquí porque cuatro acciones de UI vivas dependen de este
 * endpoint; en su lugar `OrdersService.update` delega `state: 'cancelled'` en
 * `OrderFlowService.cancelOrder` para que la cancelación siempre libere sus
 * reservas. Antes de exponer un estado nuevo por esta vía, verificar que su
 * transición también pase por el seam.
 */
export class UpdateOrderDto extends PartialType(CreateOrderDto) {
  @IsOptional()
  @IsDateString()
  estimated_delivery_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internal_notes?: string;

  @IsOptional()
  @IsInt()
  shipping_method_id?: number;

  @IsOptional()
  @IsInt()
  shipping_rate_id?: number;

  @IsOptional()
  @IsEnum(order_delivery_type_enum)
  delivery_type?: order_delivery_type_enum;
}
