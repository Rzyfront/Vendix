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
} from 'class-validator';
import { Type } from 'class-transformer';

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
