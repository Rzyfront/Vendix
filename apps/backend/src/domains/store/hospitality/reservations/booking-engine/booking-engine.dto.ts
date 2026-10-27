import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** H6.6 — traveler search in the storefront: stay dates and guests. */
export class BookingSearchDto {
  @ApiProperty({ description: 'Llegada (YYYY-MM-DD).' })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  arrival_date!: string;

  @ApiProperty({ description: 'Salida, exclusiva (YYYY-MM-DD).' })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  departure_date!: string;

  @ApiProperty({ description: 'Adultos.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  adults!: number;

  @ApiProperty({ required: false, description: 'Niños.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  children?: number;
}

/** H6.6 — "Reservar": one room of a type, held until paid online. */
export class CreateBookingHoldDto extends BookingSearchDto {
  @ApiProperty({ description: 'Tipo de habitación.' })
  @Type(() => Number)
  @IsInt()
  unit_type_id!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({
    description: 'Página de la tienda a la que Wompi vuelve; se le agrega /{id} de la reserva.',
  })
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false })
  @MaxLength(500)
  return_url!: string;
}
