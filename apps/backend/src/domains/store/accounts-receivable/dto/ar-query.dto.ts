import {
  IsOptional,
  IsString,
  IsNumber,
  IsDateString,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ArStatusFilter {
  OPEN = 'open',
  PARTIAL = 'partial',
  OVERDUE = 'overdue',
  PAID = 'paid',
  WRITTEN_OFF = 'written_off',
}

export class ArQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(ArStatusFilter)
  status?: ArStatusFilter;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  customer_id?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsString()
  sort_by?: string = 'due_date';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'asc';
}
