import {
  IsInt,
  IsDateString,
  IsString,
  IsOptional,
  IsEnum,
  IsIn,
  IsBoolean,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { order_channel_enum } from '@prisma/client';

/**
 * Deposit taken with an admin booking of a station (S15). `desk` = the money is
 * received now; `link` = a payment page is opened and the slot is held (D11).
 */
export class BookingDepositDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El anticipo debe tener máximo 2 decimales' })
  @Min(0.01, { message: 'El anticipo debe ser mayor a cero' })
  @Max(9_999_999_999.99)
  amount: number;

  @IsIn(['desk', 'link'], { message: 'El anticipo se recibe en caja o por enlace de pago' })
  mode: 'desk' | 'link';

  /** Canonical method of a desk deposit: cash, bank_transfer, card... Defaults to cash. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  method?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_payment_method_id?: number;

  /** Idempotency key of this deposit. */
  @IsString()
  @MaxLength(100)
  request_id: string;
}

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
  @Type(() => Number)
  customer_id?: number;

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

  /** Required unless `is_open_ended`. `end_time <= start_time` ends the next day (S21). */
  @ValidateIf((o: CreateBookingDto) => !o.is_open_ended)
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'end_time debe tener formato HH:mm',
  })
  end_time: string;

  /** Day the booking ends (`YYYY-MM-DD`). Defaults to D+1 when it crosses midnight. */
  @IsOptional()
  @IsDateString()
  end_date?: string;

  /** Booking without an end (D9): station services only. */
  @IsOptional()
  @IsBoolean()
  is_open_ended?: boolean;

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
  @IsInt()
  @Type(() => Number)
  station_id?: number;

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

  /** Deposit to take with the booking (stations that charge one, S15). */
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingDepositDto)
  deposit?: BookingDepositDto;
}
