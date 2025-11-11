import {
  IsInt,
  IsString,
  IsOptional,
  IsDecimal,
  IsArray,
  ValidateNested,
  IsEnum,
  Min,
  IsDateString,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { order_state_enum, payments_state_enum } from '@prisma/client';

export class CreateOrderItemDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_variant_id?: number;

  @IsString()
  product_name: string;

  @IsOptional()
  @IsString()
  variant_sku?: string;

  @IsOptional()
  @IsString()
  variant_attributes?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @Transform(({ value }) => parseFloat(value))
  @IsDecimal({ decimal_digits: '0,2' })
  unit_price: number;

  @Transform(({ value }) => parseFloat(value))
  @IsDecimal({ decimal_digits: '0,2' })
  total_price: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsDecimal({ decimal_digits: '0,5' })
  tax_rate?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsDecimal({ decimal_digits: '0,2' })
  tax_amount_item?: number;
}

export class CreateOrderDto {
  @IsInt()
  @Min(1)
  customer_id: number;

  @IsInt()
  @Min(1)
  store_id: number;

  @IsOptional()
  @IsString()
  order_number?: string;

  @IsOptional()
  @IsEnum(order_state_enum)
  state?: order_state_enum;

  @IsOptional()
  @IsEnum(payments_state_enum)
  payment_status?: payments_state_enum;

  @Transform(({ value }) => parseFloat(value))
  @IsDecimal({ decimal_digits: '0,2' })
  subtotal: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsDecimal({ decimal_digits: '0,2' })
  tax_amount?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsDecimal({ decimal_digits: '0,2' })
  shipping_cost?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsDecimal({ decimal_digits: '0,2' })
  discount_amount?: number;

  @Transform(({ value }) => parseFloat(value))
  @IsDecimal({ decimal_digits: '0,2' })
  total_amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  billing_address_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_address_id?: number;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  @IsOptional()
  @IsDateString()
  estimated_delivery_date?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
