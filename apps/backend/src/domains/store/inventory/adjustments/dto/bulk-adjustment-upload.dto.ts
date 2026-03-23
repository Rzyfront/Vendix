import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsIn,
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

export class BulkAdjustmentUploadDto {
  @IsNumber()
  @IsNotEmpty()
  @Type(() => Number)
  location_id: number;

  @IsString()
  @IsIn(VALID_ADJUSTMENT_TYPES)
  @IsOptional()
  adjustment_type?: string = 'count_variance';

  @IsOptional()
  @IsString()
  description?: string;
}

export class BulkAdjustmentItemResultDto {
  row_number: number;
  sku: string;
  product_name?: string;
  status: 'success' | 'error';
  message?: string;
  quantity_before?: number;
  quantity_after?: number;
  quantity_change?: number;
}

export class BulkAdjustmentUploadResultDto {
  success: boolean;
  total_processed: number;
  successful: number;
  failed: number;
  results: BulkAdjustmentItemResultDto[];
}
