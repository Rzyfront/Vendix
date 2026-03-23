import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsInt,
  IsArray,
  ValidateNested,
  IsDateString,
  IsEnum,
  IsBoolean,
  Min,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

// ===== Items sub-DTO =====

export class LayawayItemDto {
  @IsInt()
  @Type(() => Number)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  product_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  variant_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  unit_price: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  discount_amount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  tax_amount?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  location_id?: number;
}

// ===== Installment sub-DTO =====

export class LayawayInstallmentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @IsDateString()
  due_date: string;
}

// ===== Create DTO =====

export class CreateLayawayDto {
  @IsInt()
  @Type(() => Number)
  customer_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  down_payment_amount?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  down_payment_method_id?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LayawayItemDto)
  items: LayawayItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LayawayInstallmentDto)
  installments: LayawayInstallmentDto[];
}

// ===== Query DTO =====

export class LayawayQueryDto {
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
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  customer_id?: number;
}

// ===== Make Payment DTO =====

export class MakeLayawayPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  installment_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_payment_method_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  transaction_id?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ===== Modify Installments DTO =====

export class ModifyInstallmentDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  id?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @IsDateString()
  due_date: string;
}

export class ModifyInstallmentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModifyInstallmentDto)
  installments: ModifyInstallmentDto[];
}

// ===== Cancel DTO =====

export class CancelLayawayDto {
  @IsString()
  @IsNotEmpty()
  cancellation_reason: string;
}
