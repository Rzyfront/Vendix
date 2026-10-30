import {
  IsInt,
  IsPositive,
  Max,
  MaxLength,
  IsString,
  IsOptional,
  Matches,
  IsIn,
  IsEnum,
} from 'class-validator';
import {
  IsAfterStartTime,
  IsCivilDate,
  MAX_INT4,
} from '../../../store/reservations/dto/booking-time.validators';
import { booking_service_location_enum } from '@prisma/client';

export class CreateEcommerceBookingDto {
  @IsInt()
  @IsPositive()
  @Max(MAX_INT4)
  product_id: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_INT4)
  product_variant_id?: number;

  @IsCivilDate()
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
  @IsAfterStartTime()
  end_time: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * Appointment redesign phase 2 — dónde se realiza el servicio.
   * `home` requiere `service_address_id` Y que el producto tenga
   * `is_eligible_for_home_service = true` (el controller valida esto
   * antes de llamar al service). Default `shop` (legacy).
   */
  @IsOptional()
  @IsEnum(booking_service_location_enum)
  service_location_type?: booking_service_location_enum;

  /**
   * FK a `addresses` (del customer). Obligatorio cuando
   * `service_location_type = 'home'`; ignorado cuando `shop`.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_INT4)
  service_address_id?: number;
}
