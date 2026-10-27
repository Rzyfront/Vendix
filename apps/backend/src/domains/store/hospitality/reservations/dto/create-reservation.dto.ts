import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
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

  @ApiProperty({
    required: false,
    description: 'Plan tarifario (H2.1). Vacío = precio base del tipo de habitación.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rate_plan_id?: number;
}

/** Most rooms one reservation can hold (a group bigger than this is split). */
export const MAX_ROOMS_PER_RESERVATION = 30;

/** One room of a reservation: the room type, its occupancy and its rate plan. */
export class ReservationRoomDto {
  @ApiProperty({ description: 'Tipo de habitación.' })
  @Type(() => Number)
  @IsInt()
  unit_type_id!: number;

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

  @ApiProperty({
    required: false,
    description: 'Plan tarifario (H2.1). Vacío = precio base del tipo de habitación.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rate_plan_id?: number;
}

/**
 * Nightly reservation of one or more rooms (H1.5) for a customer (holder).
 * Every room shares the stay dates; it is sold all or nothing.
 */
export class CreateReservationDto {
  @ApiProperty({ description: 'Llegada, fecha civil de la tienda (YYYY-MM-DD).' })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  arrival_date!: string;

  @ApiProperty({ description: 'Salida, exclusiva: esa noche no se cobra (YYYY-MM-DD).' })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  departure_date!: string;

  @ApiProperty({ type: [ReservationRoomDto], description: 'Habitaciones de la reserva.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROOMS_PER_RESERVATION)
  @ValidateNested({ each: true })
  @Type(() => ReservationRoomDto)
  rooms!: ReservationRoomDto[];

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
