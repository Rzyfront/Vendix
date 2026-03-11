import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QueryInvoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsEnum([
    'draft',
    'validated',
    'sent',
    'accepted',
    'rejected',
    'cancelled',
    'voided',
  ])
  status?: string;

  @IsOptional()
  @IsEnum([
    'sales_invoice',
    'purchase_invoice',
    'credit_note',
    'debit_note',
    'export_invoice',
  ])
  invoice_type?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  customer_id?: number;
}
