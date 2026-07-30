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
 * endpoint (cancelar desde la lista, marcar enviado, marcar entregado y la
 * transición manual de "listo para recoger sin pago").
 *
 * En su lugar, `OrdersService.update` extrae `state` del payload y lo delega
 * SIEMPRE en `OrderFlowService.forceOrderState`, el carril forzado del seam:
 * conserva la capacidad de saltarse la máquina de estados —que es la razón de
 * existir de esos botones— pero ejecuta la cadena de efectos completa (liberar
 * o consumir reservas, emitir eventos) y audita la forzada. `state` nunca llega
 * al `prisma.orders.update` de ese método, así que agregar un estado nuevo al
 * enum no reabre el agujero: pasa por el seam automáticamente.
 *
 * `payment_status` sigue escribiéndose en crudo por esta vía y NO tiene un seam
 * equivalente. Antes de usarlo para conducir un flujo de cobro, revisar si
 * necesita el mismo tratamiento.
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
