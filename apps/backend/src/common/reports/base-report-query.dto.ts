/**
 * BaseReportQueryDto — the single common filter DTO every admin report/analytics
 * query extends.
 *
 * It holds ONLY the fields shared by all reports: the date range (`date_from` /
 * `date_to`) and pagination (`page` / `limit`). Report-specific fields
 * (presets, granularity, sort, category filters, ...) live in the extending DTOs.
 *
 * Semantics contract (do NOT re-implement — reuse the shared machinery):
 *  - `date_from` / `date_to` are `YYYY-MM-DD` CALENDAR dates, interpreted in the
 *    STORE timezone (never UTC). Range resolution — including pushing `date_to`
 *    to end-of-day (23:59:59.999) in the store TZ — is owned by
 *    `parseDateRange(query, tz)` (analytics/utils/date.util) which delegates to
 *    `resolveLocalDateRange` in `@common/utils/store-timezone.util`. This DTO
 *    only declares/validates the raw input strings; it never parses ranges.
 *  - `page` / `limit` are optional positive integers coerced from query strings
 *    by the global `ValidationPipe` (`enableImplicitConversion` + `@Type`).
 */
import { IsDateString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class BaseReportQueryDto {
  /** Inclusive range start — `YYYY-MM-DD`, interpreted in the store timezone. */
  @IsOptional()
  @IsDateString()
  date_from?: string;

  /** Inclusive range end — `YYYY-MM-DD`; pushed to end-of-day by `parseDateRange`. */
  @IsOptional()
  @IsDateString()
  date_to?: string;

  /** 1-based page number for paginated reports. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  /** Page size for paginated reports. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}
