import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAccountDto {
  @IsString()
  @MaxLength(20)
  code: string;

  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  account_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  nature?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  parent_code?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  parent_id?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;

  @IsOptional()
  @IsBoolean()
  accepts_entries?: boolean = false;
}
