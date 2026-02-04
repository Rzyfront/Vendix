import { IsOptional, IsString, IsNumber, IsEnum, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { order_channel_enum } from '@prisma/client';

export enum DatePreset {
  TODAY = 'today',
  YESTERDAY = 'yesterday',
  THIS_WEEK = 'thisWeek',
  LAST_WEEK = 'lastWeek',
  THIS_MONTH = 'thisMonth',
  LAST_MONTH = 'lastMonth',
  THIS_YEAR = 'thisYear',
  LAST_YEAR = 'lastYear',
}

export enum Granularity {
  HOUR = 'hour',
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

export class AnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsEnum(DatePreset)
  date_preset?: DatePreset;

  @IsOptional()
  @IsEnum(Granularity)
  granularity?: Granularity;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 50;

  @IsOptional()
  @IsString()
  sort_by?: string;

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';
}

export class SalesAnalyticsQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  category_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  brand_id?: number;

  @IsOptional()
  @IsString()
  payment_method?: string;

  @IsOptional()
  @IsEnum(order_channel_enum)
  channel?: order_channel_enum;
}

export class InventoryAnalyticsQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  location_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  category_id?: number;

  @IsOptional()
  @IsString()
  status?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'overstock';

  @IsOptional()
  @IsString()
  movement_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  days_threshold?: number;
}
