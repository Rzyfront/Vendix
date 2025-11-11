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

  @IsOptional()
  @IsEnum(['draft', 'approved', 'in_transit', 'completed', 'cancelled'])
  status?: 'draft' | 'approved' | 'in_transit' | 'completed' | 'cancelled';

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
