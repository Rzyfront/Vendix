import {
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsNumber,
  IsInt,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  settlement_type_enum,
  dispatch_payment_timing_enum,
  cost_settlement_timing_enum,
} from '@prisma/client';

/**
 * Plan Despacho Economía — FASE 2 paso 8.
 * Política tipada por método de envío.
 * Las reglas cruzadas (ejecutor coherente con `type`) se validan en el
 * servicio porque requieren lookups al tenant (vehículo/supplier/store).
 */
export class EnableShippingMethodDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsObject()
  custom_config?: any;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  display_order?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  min_order_amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  max_order_amount?: number;

  @IsOptional()
  @IsBoolean()
  collects_payment?: boolean;

  @IsOptional()
  @IsEnum(dispatch_payment_timing_enum)
  payment_timing?: dispatch_payment_timing_enum;

  @IsOptional()
  @IsEnum(settlement_type_enum)
  generates_transport_cost?: settlement_type_enum;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  default_vehicle_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  default_driver_user_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  default_carrier_supplier_id?: number;

  @IsOptional()
  @IsEnum(cost_settlement_timing_enum)
  cost_settlement_timing?: cost_settlement_timing_enum;
}

export class UpdateStoreShippingMethodDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsObject()
  custom_config?: any;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  display_order?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  min_order_amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  max_order_amount?: number;

  // Política (FASE 2 paso 8).
  @IsOptional()
  @IsBoolean()
  collects_payment?: boolean;

  @IsOptional()
  @IsEnum(dispatch_payment_timing_enum)
  payment_timing?: dispatch_payment_timing_enum;

  @IsOptional()
  @IsEnum(settlement_type_enum)
  generates_transport_cost?: settlement_type_enum;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  default_vehicle_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  default_driver_user_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  default_carrier_supplier_id?: number;

  @IsOptional()
  @IsEnum(cost_settlement_timing_enum)
  cost_settlement_timing?: cost_settlement_timing_enum;
}

export class ShippingMethodOrderItem {
  @IsInt()
  @Type(() => Number)
  id: number;
}

export class ReorderShippingMethodsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShippingMethodOrderItem)
  methods: ShippingMethodOrderItem[];
}