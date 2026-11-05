import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { order_channel_enum } from '@prisma/client';

export const MAX_SERIES_OCCURRENCES = 26;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Body of `POST store/reservations/series[/preview]` (S19). */
export class CreateBookingSeriesDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  customer_id?: number;

  @IsInt()
  @Type(() => Number)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  station_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  provider_id?: number;

  @IsIn(['daily', 'weekly'], { message: 'La frecuencia es diaria o semanal' })
  frequency: 'daily' | 'weekly';

  /** Every N days/weeks. */
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'El intervalo debe ser de al menos 1' })
  @Max(52)
  @Type(() => Number)
  interval_count?: number;

  /** First occurrence, `YYYY-MM-DD`. */
  @Matches(DATE_RE, { message: 'start_date debe tener formato YYYY-MM-DD' })
  start_date: string;

  @Matches(TIME_RE, { message: 'start_time debe tener formato HH:mm' })
  start_time: string;

  /** `end_time <= start_time` ends the next day. */
  @Matches(TIME_RE, { message: 'end_time debe tener formato HH:mm' })
  end_time: string;

  @IsInt()
  @Min(1, { message: 'La serie necesita al menos 1 repetición' })
  @Max(MAX_SERIES_OCCURRENCES, {
    message: `Una serie admite máximo ${MAX_SERIES_OCCURRENCES} repeticiones`,
  })
  @Type(() => Number)
  occurrences: number;

  /** Default true: free dates are created and the colliding ones are reported. */
  @IsOptional()
  @IsBoolean()
  skip_conflicts?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsEnum(order_channel_enum)
  channel?: order_channel_enum;
}

/** Body (or query) of `POST store/reservations/series/:id/cancel`. */
export class CancelBookingSeriesDto {
  /** First occurrence index to cancel (0-based). Defaults to 0 = the whole series. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  from?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
