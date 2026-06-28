import { IsDateString, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO for the provider availability overview endpoint.
 *
 * Returns a per-provider × per-day breakdown of slot availability,
 * occupancy rate, and aggregate stats for the reservations dashboard.
 *
 * Range is inclusive on both ends. Max recommended range: 14 days
 * (the frontend caps the timeline at 7 days, but the backend accepts
 * longer windows for analytics).
 */
export class AvailabilityOverviewQueryDto {
  @IsDateString()
  date_from: string;

  @IsDateString()
  date_to: string;

  /** Filter to a single provider. Omit for all active providers. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  provider_id?: number;

  /**
   * Optional: only count slots that match this service's duration.
   * If omitted, uses a 30-min default grid so the overview is
   * service-agnostic and shows total capacity at a glance.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_id?: number;

  /** Granularity in minutes for the timeline grid (default 30). */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  slot_minutes?: number;
}