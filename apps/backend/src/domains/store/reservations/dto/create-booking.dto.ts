import {
  IsInt,
  IsDateString,
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
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
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'start_time debe tener formato HH:mm',
  })
  start_time: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'end_time debe tener formato HH:mm',
  })
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
  product_variant_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  order_id?: number;

  /**
   * Optional table assignment. When set, the table is marked as
   * 'reserved' on creation and is surfaced on the floor map.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  table_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  provider_id?: number;

  @IsOptional()
  @IsBoolean()
  skip_availability_check?: boolean;

  @IsOptional()
  @IsBoolean()
  skip_order_creation?: boolean;

  /**
   * Where the service will be performed. `home` = technician goes to the
   * customer's address (service_address_id is the customer's address);
   * `shop` = customer goes to the technician's local. Defaults to
   * `shop` for backwards compatibility with existing POS/ecommerce flows.
   */
  @IsOptional()
  @IsEnum(['home', 'shop'])
  service_location_type?: 'home' | 'shop';

  /**
   * FK to `addresses.id`. REQUIRED when service_location_type = 'home'
   * (validated in the service). Ignored when service_location_type = 'shop'.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  service_address_id?: number;
}
