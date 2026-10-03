import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { AnalyticsQueryDto } from './analytics-query.dto';

export const SALES_DIMENSIONS = ['supplier', 'brand'] as const;
export type SalesDimension = (typeof SALES_DIMENSIONS)[number];

export const SALES_DIMENSION_VIEWS = ['product', 'user', 'customer'] as const;
export type SalesDimensionView = (typeof SALES_DIMENSION_VIEWS)[number];

/**
 * Parses the `ids` query value into `number[]`.
 *
 * The global ValidationPipe runs with `enableImplicitConversion`, so the value
 * may arrive as a CSV string (`"3,5,0"`), an already-coerced number (`3`) or an
 * array (`ids=3&ids=5`). All three are handled. A token that is not an integer
 * becomes `NaN` so `@IsInt({ each: true })` rejects it with a 400 instead of
 * being silently dropped. Empty / absent => `undefined` (= all).
 */
export function parseIdsCsv(value: unknown): number[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const tokens: unknown[] = Array.isArray(value)
    ? value.flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
    : typeof value === 'string'
      ? value.split(',')
      : [value];
  const parsed = tokens
    .map((t) => (typeof t === 'string' ? t.trim() : t))
    .filter((t) => t !== '' && t !== undefined && t !== null)
    .map((t) => (typeof t === 'number' ? t : /^-?\d+$/.test(String(t)) ? Number(t) : NaN));
  return parsed.length > 0 ? parsed : undefined;
}

/**
 * Query for `GET store/analytics/sales/by-dimension` (+ `/export`).
 * Date fields (`date_from`, `date_to`, `date_preset`) come from
 * {@link AnalyticsQueryDto} and are resolved in the store timezone.
 */
export class SalesByDimensionQueryDto extends AnalyticsQueryDto {
  @IsIn(SALES_DIMENSIONS as unknown as string[])
  dimension!: SalesDimension;

  /** CSV of ids; `0` = "Sin proveedor" / "Sin marca". Empty = all. */
  @IsOptional()
  @Transform(({ value }) => parseIdsCsv(value))
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(0, { each: true })
  ids?: number[];

  @IsOptional()
  @IsIn(SALES_DIMENSION_VIEWS as unknown as string[])
  view?: SalesDimensionView = 'product';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  override page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  override limit?: number;
}
