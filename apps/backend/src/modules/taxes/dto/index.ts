import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
  IsDecimal,
  MaxLength,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

// Enums
export enum TaxStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum TaxType {
  PERCENTAGE = 'percentage',
  FIXED = 'fixed',
}

// Create Tax Category DTO
export class CreateTaxCategoryDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsEnum(TaxType)
  type: TaxType;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  rate: number;

  @IsInt()
  @Min(1)
  store_id: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  organization_id?: number;

  @IsBoolean()
  @IsOptional()
  is_inclusive?: boolean = false;

  @IsBoolean()
  @IsOptional()
  is_compound?: boolean = false;

  @IsInt()
  @IsOptional()
  @Min(0)
  sort_order?: number = 0;

  @IsEnum(TaxStatus)
  @IsOptional()
  status?: TaxStatus = TaxStatus.ACTIVE;
}

// Update Tax Category DTO
export class UpdateTaxCategoryDto extends PartialType(CreateTaxCategoryDto) {
  @IsInt()
  @IsOptional()
  @Min(1)
  store_id?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  organization_id?: number;
}

// Tax Category Query DTO
export class TaxCategoryQueryDto {
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
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  store_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  organization_id?: number;

  @IsOptional()
  @IsEnum(TaxType)
  type?: TaxType;

  @IsOptional()
  @IsEnum(TaxStatus)
  status?: TaxStatus;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_inclusive?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_compound?: boolean;

  @IsOptional()
  @IsString()
  sort_by?: string = 'sort_order';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'asc';

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  include_inactive?: boolean = false;
}

// Tax Calculation DTO
export class TaxCalculationDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  subtotal: number;

  @IsInt()
  @Min(1)
  store_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_address_id?: number;
}

// Tax Calculation Result DTO
export class TaxCalculationResultDto {
  subtotal: number;
  total_tax: number;
  total_amount: number;
  tax_breakdown: {
    tax_category_id: number;
    name: string;
    type: TaxType;
    rate: number;
    is_inclusive: boolean;
    is_compound: boolean;
    tax_amount: number;
  }[];
}


