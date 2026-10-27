import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Stay to price and check: room type, dates (YYYY-MM-DD) and occupancy. */
export class ReservationQuoteDto {
  @ApiProperty({ description: 'Tipo de habitación.' })
  @Type(() => Number)
  @IsInt()
  unit_type_id!: number;

  @ApiProperty({ description: 'Llegada, fecha civil de la tienda (YYYY-MM-DD).' })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  arrival_date!: string;

  @ApiProperty({ description: 'Salida, exclusiva: esa noche no se cobra (YYYY-MM-DD).' })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  departure_date!: string;

  @ApiProperty({ description: 'Adultos.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  adults!: number;

  @ApiProperty({ required: false, description: 'Niños.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  children?: number;
}

/** Nightly reservation of one room of a type for a customer (holder). */
export class CreateReservationDto extends ReservationQuoteDto {
  @ApiProperty({ description: 'Cliente titular de la reserva.' })
  @Type(() => Number)
  @IsInt()
  customer_id!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
