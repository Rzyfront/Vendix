import { PartialType } from '@nestjs/mapped-types';
import { CreateOrderDto } from './create-order.dto';
import { IsOptional, IsDateString, IsString, MaxLength } from 'class-validator';

/**
 * DTO for updating order metadata.
 * Note: Order state changes must be done through OrderFlowService endpoints:
 * - POST /store/orders/:id/flow/pay
 * - POST /store/orders/:id/flow/ship
 * - POST /store/orders/:id/flow/deliver
 * - POST /store/orders/:id/flow/confirm-delivery
 * - POST /store/orders/:id/flow/cancel
 * - POST /store/orders/:id/flow/refund
 */
export class UpdateOrderDto extends PartialType(CreateOrderDto) {
  @IsOptional()
  @IsDateString()
  estimated_delivery_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internal_notes?: string;
}
