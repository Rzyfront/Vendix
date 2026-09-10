import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { BaseReportQueryDto } from '@common/reports/base-report-query.dto';

/**
 * Query DTOs for the dispatch (`despachos`) analytics reports
 * (CP-despachos-reportes, steps B.1 + B.2).
 *
 * All three extend {@link BaseReportQueryDto}, which owns `date_from` /
 * `date_to` (`YYYY-MM-DD` calendar dates interpreted in the STORE timezone)
 * and `page` / `limit`. Range resolution (pushing `date_to` to end-of-day in
 * the store TZ) is owned by `parseDateRange(query, tz)` — this file only
 * declares/validates raw inputs, never parses ranges.
 *
 * The store itself NEVER travels in the query: it always comes from the JWT
 * request context (`RequestContextService`), so a foreign-store token cannot
 * spoof another store's data (ERR-01 is enforced by scope, not by params).
 */
export class DispatchRemisionesQueryDto extends BaseReportQueryDto {
  /** `dispatch_note_status_enum`: draft | confirmed | delivered | received | invoiced | voided. */
  @IsOptional()
  @IsIn(['draft', 'confirmed', 'delivered', 'received', 'invoiced', 'voided'])
  status?: string;

  /** `dispatch_note_subtype_enum`. */
  @IsOptional()
  @IsIn([
    'customer_delivery',
    'customer_return',
    'transfer_out',
    'transfer_in',
    'purchase_receipt',
  ])
  subtype?: string;

  /** Free text matched against `dispatch_number` / `customer_name`. */
  @IsOptional()
  @IsString()
  search?: string;
}

export class DispatchPlanillasQueryDto extends BaseReportQueryDto {
  /** `dispatch_route_status_enum`: draft | dispatched | in_transit | closed | voided. */
  @IsOptional()
  @IsIn(['draft', 'dispatched', 'in_transit', 'closed', 'voided'])
  status?: string;

  /** Free text matched against `route_number` / `route_code`. */
  @IsOptional()
  @IsString()
  search?: string;
}

export class DispatchVehiculosQueryDto extends BaseReportQueryDto {
  /**
   * Roster filter. Vehicles are a CURRENT snapshot (lifetime aggregates), NOT
   * a time series: `date_from` / `date_to` are accepted (base DTO) but do NOT
   * filter the roster — documented, by design.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  is_active?: boolean;

  /** Free text matched against `plate` / `brand` / `model_name`. */
  @IsOptional()
  @IsString()
  search?: string;
}
