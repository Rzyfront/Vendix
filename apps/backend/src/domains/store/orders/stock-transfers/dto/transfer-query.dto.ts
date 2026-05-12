import {
  IsOptional,
  IsNumber,
  IsString,
  IsEnum,
  IsDate,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TransferQueryDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;

  /**
   * Lifecycle filter. Canonical values (P4 M3):
   *   `pending`, `approved`, `in_transit`, `received`, `cancelled`.
   *
   * Legacy aliases still accepted for backward compatibility with older
   * clients and historical rows: `draft`, `completed`.
   */
  @IsOptional()
  @IsEnum([
    'pending',
    'approved',
    'in_transit',
    'received',
    'cancelled',
    // legacy aliases — kept to preserve old frontend tabs / saved filters
    'draft',
    'completed',
  ])
  status?:
    | 'pending'
    | 'approved'
    | 'in_transit'
    | 'received'
    | 'cancelled'
    | 'draft'
    | 'completed';

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  from_location_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  to_location_id?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  transfer_date_from?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  transfer_date_to?: Date;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  created_by?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(['transfer_date', 'created_at', 'transfer_number'])
  sort_by?: 'transfer_date' | 'created_at' | 'transfer_number';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sort_order?: 'asc' | 'desc';
}
