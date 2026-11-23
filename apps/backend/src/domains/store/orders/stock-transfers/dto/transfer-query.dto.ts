import {
  IsBoolean,
  IsOptional,
  IsNumber,
  IsString,
  IsDate,
  IsIn,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

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
  @IsIn([
    'pending',
    'approved',
    'in_transit',
    'received',
    'cancelled',
    // legacy aliases — kept to preserve old frontend tabs / saved filters
    'draft',
    'completed',
    // P2 (D4) — recepción parcial y cierre con pérdida.
    'partially_received',
    'closed_with_loss',
  ])
  status?:
    | 'pending'
    | 'approved'
    | 'in_transit'
    | 'received'
    | 'cancelled'
    | 'draft'
    | 'completed'
    | 'partially_received'
    | 'closed_with_loss';

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

  /**
   * D8 — solo salidas externas con alerta (sin documento soporte ni motivo).
   * Llega como texto en la URL (`?with_alert=true`).
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  with_alert?: boolean;

  @IsOptional()
  @IsIn(['transfer_date', 'created_at', 'transfer_number'])
  sort_by?: 'transfer_date' | 'created_at' | 'transfer_number';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc';
}
