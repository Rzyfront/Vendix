import { IsDateString, IsOptional, IsInt, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { booking_status_enum } from '@prisma/client';

export class CalendarQueryDto {
  @IsDateString()
  date_from: string;

  @IsDateString()
  date_to: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  product_id?: number;

  @IsOptional()
  @IsEnum(booking_status_enum)
  status?: booking_status_enum;
}
