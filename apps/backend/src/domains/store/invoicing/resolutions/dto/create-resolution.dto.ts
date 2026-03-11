import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateResolutionDto {
  @IsString()
  @MaxLength(100)
  resolution_number: string;

  @IsDateString()
  resolution_date: string;

  @IsString()
  @MaxLength(10)
  prefix: string;

  @IsNumber()
  @Type(() => Number)
  range_from: number;

  @IsNumber()
  @Type(() => Number)
  range_to: number;

  @IsDateString()
  valid_from: string;

  @IsDateString()
  valid_to: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  technical_key?: string;
}
