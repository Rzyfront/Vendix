import {
  IsInt,
  IsDateString,
  IsString,
  IsBoolean,
  IsOptional,
  Min,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExceptionDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_id?: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_closed?: boolean = false;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'custom_start_time debe tener formato HH:mm' })
  custom_start_time?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'custom_end_time debe tener formato HH:mm' })
  custom_end_time?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  custom_capacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
