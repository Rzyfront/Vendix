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

export enum ApStatusFilter {
  OPEN = 'open',
  PARTIAL = 'partial',
  OVERDUE = 'overdue',
  PAID = 'paid',
  WRITTEN_OFF = 'written_off',
}

export enum ApPriorityFilter {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

export class ApQueryDto {
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
  @IsEnum(ApStatusFilter)
  status?: ApStatusFilter;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  supplier_id?: number;

  @IsOptional()
  @IsEnum(ApPriorityFilter)
  priority?: ApPriorityFilter;

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
