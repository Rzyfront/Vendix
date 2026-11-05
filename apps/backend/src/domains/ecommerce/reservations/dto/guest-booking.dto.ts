import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Contact data of a visitor booking without a session. Every field is optional
 * at DTO level on purpose: a missing one is rejected by the guest booking
 * service with `STATION_BOOKING_014`, so the client gets a stable error code.
 */
export class GuestBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}
