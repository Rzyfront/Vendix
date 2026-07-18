import {
  IsBoolean,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * One row of the weekly business-hours master calendar. The store's
 * availability service intersects provider schedules against these
 * windows so a provider can't be booked outside the store's open hours.
 */
export class BusinessHoursDayDto {
  /// 0 = Sunday, 6 = Saturday (matches `provider_schedules.day_of_week`).
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week: number;

  /// HH:mm in 24h format.
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'start_time debe tener formato HH:mm',
  })
  start_time: string;

  /// HH:mm in 24h format. Must be strictly after start_time.
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'end_time debe tener formato HH:mm',
  })
  end_time: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;
}