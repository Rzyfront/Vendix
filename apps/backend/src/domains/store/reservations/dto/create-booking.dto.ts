import {
  IsInt,
  IsString,
  IsOptional,
  IsEnum,
  IsIn,
  IsBoolean,
  IsPositive,
  Matches,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { order_channel_enum } from '@prisma/client';
import {
  IsAfterStartTime,
  IsCivilDate,
  MAX_INT4,
} from './booking-time.validators';

export class CreateBookingDto {
  /**
   * Optional customer FK. CP-POS-SVC-PERF-001 / HU-B + HU-C: a
   * "Venta Anónima" (anonymous sale) can still carry a booking
   * alongside the order — the cashier picks staff + day + time even
   * when there's no linked customer. Application-level guards still
   * validate provider / date / start / end before persisting.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_INT4)
  @Type(() => Number)
  customer_id?: number;

  @IsInt()
  @IsPositive()
  @Max(MAX_INT4)
  @Type(() => Number)
  product_id: number;

  @IsCivilDate()
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
  @IsAfterStartTime()
  end_time: string;

  @IsOptional()
  @IsEnum(order_channel_enum)
  channel?: order_channel_enum;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_INT4)
  @Type(() => Number)
  product_variant_id?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_INT4)
  @Type(() => Number)
  order_id?: number;

  /**
   * Optional table assignment. When set, the table is marked as
   * 'reserved' on creation and is surfaced on the floor map.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_INT4)
  @Type(() => Number)
  table_id?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_INT4)
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
  @IsIn(['home', 'shop'])
  service_location_type?: 'home' | 'shop';

  /**
   * FK to `addresses.id`. REQUIRED when service_location_type = 'home'
   * (validated in the service). Ignored when service_location_type = 'shop'.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_INT4)
  @Type(() => Number)
  service_address_id?: number;

  /**
   * CP-POS-SVC-PERF-001 — cart-line anchor used by the POS scheduler to
   * bind this booking to a specific cart row. Optional because ecommerce
   * and admin bookings don't carry one. Persisted on `bookings.cart_item_id`
   * so future re-orders can reattach the same line.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cart_item_id?: string;
}
