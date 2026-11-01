import { IsEnum, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { booking_status_enum } from '@prisma/client';
import { BaseReportQueryDto } from '@common/reports/base-report-query.dto';

/**
 * QUI-975 — filters for `GET /store/reservations/export`.
 * `date_from`/`date_to` are `YYYY-MM-DD` calendar days matching
 * `bookings.date` (`@db.Date`, UTC-midnight business dates).
 */
export class ExportBookingsQueryDto extends BaseReportQueryDto {
  @IsOptional()
  @IsEnum(booking_status_enum)
  status?: booking_status_enum;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provider_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  product_id?: number;
}
