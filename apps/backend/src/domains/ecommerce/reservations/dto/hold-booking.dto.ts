import {
  IsInt,
  IsPositive,
  Max,
  MaxLength,
  IsString,
  IsOptional,
  Matches,
} from 'class-validator';
import {
  IsAfterStartTime,
  IsCivilDate,
  MAX_INT4,
} from '../../../store/reservations/dto/booking-time.validators';

export class HoldBookingDto {
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
}
