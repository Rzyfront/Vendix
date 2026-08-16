import {
  IsOptional,
  IsNumber,
  IsString,
  IsDate,
  IsInt,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrgTransferQueryDto {
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
   * clients and historical rows:
   *   - `draft`     → folds in `pending` + legacy `draft` rows.
   *   - `completed` → folds in `received` + legacy `completed` rows.
   * The service normalizes them in `OrgTransfersService.normalizeStatusFilter`.
   */
  @IsOptional()
  @IsIn([
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

  /**
   * Breakdown filter. When provided, restricts the result to transfers where
   * either `from_location` or `to_location` belongs to the given store.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;

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
  product_id?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['transfer_date', 'created_at', 'transfer_number'])
  sort_by?: 'transfer_date' | 'created_at' | 'transfer_number';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc';
}
