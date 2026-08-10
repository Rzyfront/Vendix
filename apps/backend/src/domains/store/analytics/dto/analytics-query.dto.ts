import {
  IsOptional,
  IsString,
  IsNumber,
  IsEnum,
  IsDateString,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { order_channel_enum } from '@prisma/client';
import { BaseReportQueryDto } from '@common/reports/base-report-query.dto';

export enum DatePreset {
  TODAY = 'today',
  YESTERDAY = 'yesterday',
  THIS_WEEK = 'thisWeek',
  LAST_WEEK = 'lastWeek',
  THIS_MONTH = 'thisMonth',
  LAST_MONTH = 'lastMonth',
  THIS_YEAR = 'thisYear',
  LAST_YEAR = 'lastYear',
  CUSTOM = 'custom',
}

export enum Granularity {
  HOUR = 'hour',
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

/**
 * Full analytics filter DTO. Extends {@link BaseReportQueryDto} (which owns the
 * shared `date_from` / `date_to` / `page` / `limit` fields with identical
 * validation) and adds the analytics-only fields: date preset, granularity, and
 * sorting. Field semantics for the inherited fields are unchanged.
 */
export class AnalyticsQueryDto extends BaseReportQueryDto {
  @IsOptional()
  @IsEnum(DatePreset)
  date_preset?: DatePreset;

  @IsOptional()
  @IsEnum(Granularity)
  granularity?: Granularity;

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

export class ProductsAnalyticsQueryDto extends AnalyticsQueryDto {
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
  search?: string;

  /**
   * QUI-622: Top Sellers ranking criterion. The two rankings (units sold vs
   * revenue generated) are distinct and almost never coincide — products with
   * high unit volume and low price, and vice versa.
   *
   * Applied in DB via the `orderBy` on the groupBy so the LIMIT caps the right
   * ranking. Defaults to `units_sold` for backwards compatibility with the
   * previous behaviour.
   */
  @IsOptional()
  @IsIn(['units_sold', 'revenue'])
  top_sellers_sort_by?: 'units_sold' | 'revenue';
}

export class InventoryAnalyticsQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  location_id?: number;

  @IsOptional()
  @IsDateString()
  as_of?: string;

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
