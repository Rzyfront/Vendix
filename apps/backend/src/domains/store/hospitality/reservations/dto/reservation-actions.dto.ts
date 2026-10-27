import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const LODGING_RESERVATION_STATUSES = [
  'tentative',
  'confirmed',
  'checked_in',
  'checked_out',
  'cancelled',
  'no_show',
] as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Search of the reservation list: guest/number text, status and stay range. */
export class ReservationQueryDto {
  @ApiProperty({ required: false, description: 'Número de reserva, nombre, email o teléfono del huésped.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiProperty({ required: false, enum: LODGING_RESERVATION_STATUSES })
  @IsOptional()
  @IsIn(LODGING_RESERVATION_STATUSES)
  status?: (typeof LODGING_RESERVATION_STATUSES)[number];

  @ApiProperty({ required: false, description: 'Estadías que ocupan alguna noche desde esta fecha (YYYY-MM-DD).' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  date_from?: string;

  @ApiProperty({ required: false, description: 'Estadías que ocupan alguna noche hasta esta fecha (YYYY-MM-DD).' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  date_to?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Cancellation of a reservation: the reason is kept in its history. */
export class CancelReservationDto {
  @ApiProperty({ description: 'Motivo de la cancelación.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El motivo es obligatorio' })
  @MaxLength(500)
  reason!: string;
}

/** Manual no-show: the reason is optional. */
export class NoShowReservationDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}
