import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsInt,
  IsEnum,
  IsArray,
  IsDateString,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePromotionDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsEnum(['percentage', 'fixed_amount'])
  type: 'percentage' | 'fixed_amount';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  value: number;

  @IsOptional()
  @IsEnum(['order', 'product', 'category'])
  scope?: 'order' | 'product' | 'category' = 'order';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  min_purchase_amount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  max_discount_amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  usage_limit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  per_customer_limit?: number;

  @IsDateString()
  start_date: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_auto_apply?: boolean = false;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  priority?: number = 0;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  product_ids?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  category_ids?: number[];
}
