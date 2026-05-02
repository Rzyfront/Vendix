import {
  IsInt,
  IsOptional,
  IsString,
  IsObject,
  IsArray,
  ValidateNested,
  Min,
  IsDateString,
  Matches,
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
  @IsObject()
  shipping_address?: {
    address_line1: string;
    address_line2?: string;
    city: string;
    state_province?: string;
    country_code: string;
    postal_code?: string;
    phone_number?: string;
  };

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
