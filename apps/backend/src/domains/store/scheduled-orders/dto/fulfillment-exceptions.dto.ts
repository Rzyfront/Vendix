import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class AvailabilityQueryDto {
  @ApiProperty({ example: '2026-11-03' })
  @Matches(DATE_ONLY, { message: 'La fecha debe tener el formato YYYY-MM-DD.' })
  from: string;

  @ApiProperty({ example: '2026-11-09' })
  @Matches(DATE_ONLY, { message: 'La fecha debe tener el formato YYYY-MM-DD.' })
  to: string;
}

export class CreateFulfillmentExceptionDto {
  @ApiProperty({ example: '2026-12-25', description: 'Fecha en hora de tienda' })
  @Matches(DATE_ONLY, { message: 'La fecha debe tener el formato YYYY-MM-DD.' })
  date: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  is_closed?: boolean;

  @ApiProperty({ example: '10:00', required: false })
  @IsOptional()
  @Matches(HH_MM, { message: 'La hora debe tener el formato HH:mm.' })
  start_time?: string;

  @ApiProperty({ example: '14:00', required: false })
  @IsOptional()
  @Matches(HH_MM, { message: 'La hora debe tener el formato HH:mm.' })
  end_time?: string;

  @ApiProperty({ example: 1, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  slot_capacity?: number;

  @ApiProperty({ example: 5, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  day_capacity?: number;

  @ApiProperty({ example: 'Navidad', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class UpdateFulfillmentExceptionDto extends PartialType(
  CreateFulfillmentExceptionDto,
) {}
