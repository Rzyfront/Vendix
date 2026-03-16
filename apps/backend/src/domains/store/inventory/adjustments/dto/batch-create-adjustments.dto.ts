import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  IsIn,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

const VALID_ADJUSTMENT_TYPES = [
  'damage',
  'loss',
  'theft',
  'expiration',
  'count_variance',
  'manual_correction',
] as const;

export class AdjustmentItemDto {
  @IsNumber()
  @IsNotEmpty()
  @Type(() => Number)
  product_id: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  product_variant_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  batch_id?: number;

  @IsString()
  @IsNotEmpty()
  @IsIn(VALID_ADJUSTMENT_TYPES)
  type: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  quantity_after: number;

  @IsOptional()
  @IsString()
  reason_code?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class BatchCreateAdjustmentsDto {
  @IsNumber()
  @IsNotEmpty()
  @Type(() => Number)
  location_id: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentItemDto)
  items: AdjustmentItemDto[];
}
