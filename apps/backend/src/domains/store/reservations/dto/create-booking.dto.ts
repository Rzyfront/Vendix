import {
  IsInt,
  IsDateString,
  IsString,
  IsOptional,
  IsEnum,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { order_channel_enum } from '@prisma/client';

export class CreateBookingDto {
  @IsInt()
  @Type(() => Number)
  customer_id: number;

  @IsInt()
  @Type(() => Number)
  product_id: number;

  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'start_time debe tener formato HH:mm' })
  start_time: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'end_time debe tener formato HH:mm' })
  end_time: string;

  @IsOptional()
  @IsEnum(order_channel_enum)
  channel?: order_channel_enum;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  order_id?: number;
}
