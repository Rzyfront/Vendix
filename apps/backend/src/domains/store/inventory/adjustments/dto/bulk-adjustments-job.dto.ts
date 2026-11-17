import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { BulkJobFileDto } from '../../../bulk-uploads/dto/bulk-upload-job.dto';

const ADJUSTMENT_TYPES = [
  'damage',
  'loss',
  'theft',
  'expiration',
  'count_variance',
  'manual_correction',
  'initial_load',
] as const;

/** `POST store/inventory/adjustments/bulk/jobs` (QUI-1009). */
export class BulkAdjustmentsJobDto extends BulkJobFileDto {
  @IsString()
  @IsNotEmpty()
  session_id: string;

  @Type(() => Number)
  @IsInt()
  location_id: number;

  @ApiPropertyOptional({ enum: ADJUSTMENT_TYPES })
  @IsOptional()
  @IsString()
  @IsIn(ADJUSTMENT_TYPES)
  adjustment_type?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  initial_load_ack?: boolean;
}
