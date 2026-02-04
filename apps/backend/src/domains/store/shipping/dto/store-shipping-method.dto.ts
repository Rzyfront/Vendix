import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  IsNumber,
  IsInt,
  IsArray,
  ValidateNested,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { shipping_method_state_enum } from '@prisma/client';

export class EnableShippingMethodDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  display_name?: string;

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
}

export class UpdateStoreShippingMethodDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  display_name?: string;

  @IsOptional()
  @IsObject()
  custom_config?: any;

  @IsOptional()
  @IsEnum(shipping_method_state_enum)
  state?: shipping_method_state_enum;

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
