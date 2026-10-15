import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

const VALID_ADJUSTMENT_TYPES = [
  'damage',
  'loss',
  'theft',
  'expiration',
  'count_variance',
  'manual_correction',
  'initial_load',
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

/** Tope de filas por página al confirmar una sesión de ajuste masivo. */
export const MAX_BULK_ADJUSTMENT_UPLOAD_PAGE = 100;

/**
 * Body de `POST store/inventory/adjustments/bulk/upload-session`. Sin
 * `offset`/`limit` se confirma el archivo completo (modo legacy); con alguno
 * se procesa solo la página `[offset, offset + limit)`. `location_id` (y
 * opcionalmente tipo/descripción globales) viajan aquí porque el archivo no
 * los contiene.
 */
export class BulkAdjustmentUploadSessionDto extends BulkAdjustmentUploadDto {
  @IsString()
  @IsNotEmpty()
  session_id: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_BULK_ADJUSTMENT_UPLOAD_PAGE)
  limit?: number;
}

export class BulkAdjustmentUploadSessionResultDto extends BulkAdjustmentUploadResultDto {
  total: number;
  offset: number;
  limit: number;
  done: boolean;
}

export class BulkAdjustmentAnalysisResultDto {
  session_id: string;
  total: number;
  valid: number;
  failed: number;
  errors: { row_number: number; sku: string; message: string }[];
}
