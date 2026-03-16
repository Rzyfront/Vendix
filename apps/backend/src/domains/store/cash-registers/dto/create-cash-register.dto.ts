import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCashRegisterDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(50)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  default_opening_amount?: number;
}
