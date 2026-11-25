import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** One open block of a day. end <= start ends the next day; 00:00-00:00 = 24 h. */
export class BusinessHoursBlockDto {
  @Matches(HHMM, { message: 'start_time debe tener formato HH:mm' })
  start_time: string;

  @Matches(HHMM, { message: 'end_time debe tener formato HH:mm' })
  end_time: string;
}

/**
 * One day of the store's single weekly schedule (`settings.pos.business_hours`).
 * The store's availability service intersects provider schedules against these
 * windows so a provider can't be booked outside the store's open hours.
 */
export class BusinessHoursDayDto {
  /// 0 = Sunday, 6 = Saturday (matches `provider_schedules.day_of_week`).
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week: number;

  /// HH:mm in 24h format.
  @Matches(HHMM, {
    message: 'start_time debe tener formato HH:mm',
  })
  start_time: string;

  /// HH:mm in 24h format. end <= start means the block ends the next day (S21);
  /// 00:00-00:00 is open 24 hours.
  @Matches(HHMM, {
    message: 'end_time debe tener formato HH:mm',
  })
  end_time: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;

  /// Optional split shift (e.g. 08:00-12:00 and 14:00-18:00). When present it
  /// wins over start_time/end_time.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'Máximo 5 bloques por día' })
  @ValidateNested({ each: true })
  @Type(() => BusinessHoursBlockDto)
  blocks?: BusinessHoursBlockDto[];
}
