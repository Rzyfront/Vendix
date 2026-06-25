import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsEnum,
  IsDateString,
  IsBoolean,
} from 'class-validator';
import {
  order_state_enum,
  payments_state_enum,
  order_channel_enum,
} from '@prisma/client';
import { Transform } from 'class-transformer';

export class OrderQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(order_state_enum)
  status?: order_state_enum;

  @IsOptional()
  @IsEnum(payments_state_enum)
  payment_status?: payments_state_enum;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  customer_id?: number;

  // store_id deprecated (phase3-round2): scope is derived from RequestContextService
  // for /store/* endpoints. Use /organization/* with breakdown for cross-store views.

  @IsOptional()
  @IsString()
  sort_by?: string;

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc';

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsEnum(order_channel_enum)
  channel?: order_channel_enum;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  missing_shipping_method?: boolean;

  /**
   * "Despachable" / "Por enviar" — ref 2026-06-25.
   * Filtra órdenes pendientes de despacho: state ∈ {processing,
   * pending_payment} + delivery_type ≠ direct_delivery (incluye
   * home_delivery, pickup, other). pending_payment cubre el contraentrega
   * (COD): se despacha antes de cobrar.
   * Single source of truth compartido con orders.service.ts findAll()
   * y stores.service.ts dispatchWhere. Usado por el botón "Por enviar"
   * de la lista y por el contador del dashboard.
   * La exclusión exacta de órdenes parcialmente remisionadas se mitiga
   * en frontend vía getByOrder(orderId) hasta una V2 con subquery SQL.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  dispatchable?: boolean;
}
