import {
  IsInt,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  Min,
  IsDateString,
  Matches,
  IsEmail,
  IsBoolean,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

class CheckoutCartItemDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_variant_id?: number;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class GuestCheckoutCustomerDto {
  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  document_type?: string;

  @IsOptional()
  @IsString()
  document_number?: string;
}

export class CheckoutShippingAddressDto {
  @IsString()
  address_line1: string;

  @IsOptional()
  @IsString()
  address_line2?: string;

  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  state_province?: string;

  @IsString()
  country_code: string;

  @IsOptional()
  @IsString()
  postal_code?: string;

  @IsOptional()
  @IsString()
  phone_number?: string;
}

export class CheckoutDto {
  // Booking selections for bookable services
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutBookingDto)
  bookings?: CheckoutBookingDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_method_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_rate_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_address_id?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutShippingAddressDto)
  shipping_address?: CheckoutShippingAddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => GuestCheckoutCustomerDto)
  guest_customer?: GuestCheckoutCustomerDto;

  @IsInt()
  @Min(1)
  payment_method_id: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutCartItemDto)
  items?: CheckoutCartItemDto[];

  /**
   * Optional coupon code provided by the customer. When set, the backend
   * validates it against {@link CouponsService.validate}; the discount is
   * applied on top of automatic promotion discounts. Invalid codes raise an
   * error and abort the checkout — frontend must NOT send the code unless
   * the customer explicitly entered it.
   *
   * Trim + uppercase is done by the validator. Totals are never sent from
   * the client — backend recomputes every value.
   */
  @IsOptional()
  @IsString()
  coupon_code?: string;

  /**
   * When true, the customer is opting to pick up the order at the store
   * instead of having it shipped. This is used as a fallback when the
   * customer's address has no matching shipping zone — the frontend
   * surfaces a "Recoger en tienda" option in that case and sends this
   * flag so the backend can skip shipping_method/rate/address validation
   * and persist the order with `delivery_type='pickup'`.
   */
  @IsOptional()
  @IsBoolean()
  pickup_only?: boolean;
}

class CheckoutBookingDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_variant_id?: number;

  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'start_time debe tener formato HH:mm',
  })
  start_time: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'end_time debe tener formato HH:mm',
  })
  end_time: string;
}
