import {
  IsOptional,
  IsInt,
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  ValidateNested,
  IsDateString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateQuotationItemDto {
  @IsOptional()
  @IsInt()
  product_id?: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number;

  @IsString()
  @IsNotEmpty()
  product_name: string;

  @IsOptional()
  @IsString()
  variant_sku?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  unit_price: number;

  @IsOptional()
  @IsNumber()
  discount_amount?: number;

  @IsOptional()
  @IsNumber()
  tax_rate?: number;

  @IsOptional()
  @IsNumber()
  tax_amount_item?: number;

  @IsNumber()
  total_price: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateQuotationDto {
  @IsOptional()
  @IsInt()
  customer_id?: number;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsDateString()
  valid_until?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  @IsOptional()
  @IsString()
  terms_and_conditions?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuotationItemDto)
  items: CreateQuotationItemDto[];
}
