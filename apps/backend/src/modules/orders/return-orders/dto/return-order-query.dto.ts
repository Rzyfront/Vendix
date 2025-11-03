import {
  IsOptional,
  IsNumber,
  IsString,
  IsEnum,
  IsDate,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReturnOrderQueryDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsEnum([
    'draft',
    'requested',
    'approved',
    'received',
    'processed',
    'refunded',
    'rejected',
    'cancelled',
  ])
  status?:
    | 'draft'
    | 'requested'
    | 'approved'
    | 'received'
    | 'processed'
    | 'refunded'
    | 'rejected'
    | 'cancelled';

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  customer_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  order_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  partner_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @IsEnum([
    'defective',
    'wrong_item',
    'damaged_shipping',
    'customer_dissatisfaction',
    'expired',
    'other',
  ])
  reason?:
    | 'defective'
    | 'wrong_item'
    | 'damaged_shipping'
    | 'customer_dissatisfaction'
    | 'expired'
    | 'other';

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  return_date_from?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  return_date_to?: Date;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  refund_amount_min?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  refund_amount_max?: number;

  @IsOptional()
  @IsEnum(['refund', 'replacement', 'credit'])
  type?: 'refund' | 'replacement' | 'credit';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(['return_date', 'refund_amount', 'created_at'])
  sort_by?: 'return_date' | 'refund_amount' | 'created_at';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sort_order?: 'asc' | 'desc';
}
