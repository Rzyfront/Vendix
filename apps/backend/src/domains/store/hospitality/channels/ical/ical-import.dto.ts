import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Pastes the iCal URL of a channel into one room (H6.2). */
export class CreateIcalImportDto {
  @ApiProperty({ description: 'Habitación que bloquean las reservas del canal.' })
  @Type(() => Number)
  @IsInt()
  unit_id!: number;

  @ApiPropertyOptional({ example: 'Airbnb', maxLength: 60, default: 'Airbnb' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiProperty({ example: 'https://www.airbnb.com/calendar/ical/123.ics?s=abc', maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  url!: string;
}
