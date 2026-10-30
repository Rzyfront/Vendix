import {
  IsOptional,
  IsString,
  IsInt,
  IsEnum,
  IsDateString,
  IsIn,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { booking_status_enum, order_channel_enum } from '@prisma/client';
import { MAX_INT4 } from './booking-time.validators';

/**
 * QUI-966 (S16): `sort_by` is interpolated into the Prisma `orderBy`, so it
 * must name a real sortable `bookings` column (anything else was a 500).
 */
export const BOOKING_SORTABLE_COLUMNS = [
  'date',
  'start_time',
  'end_time',
  'status',
  'booking_number',
  'channel',
  'created_at',
  'updated_at',
] as const;
export type BookingSortableColumn = (typeof BOOKING_SORTABLE_COLUMNS)[number];

export class BookingQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(booking_status_enum)
  status?: booking_status_enum;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  @Max(MAX_INT4)
  customer_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  @Max(MAX_INT4)
  product_id?: number;

  @IsOptional()
  @IsEnum(order_channel_enum)
  channel?: order_channel_enum;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsIn(BOOKING_SORTABLE_COLUMNS)
  sort_by?: BookingSortableColumn = 'date';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'asc';
}
