import {
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  IsOptional,
  IsNumber,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBankAccountDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(50)
  account_number: string;

  @IsString()
  @MaxLength(100)
  bank_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bank_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  opening_balance?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  chart_account_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @IsBoolean()
  available_in_all_stores?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  store_ids?: number[];
}
