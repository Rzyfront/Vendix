import {
  IsString,
  IsOptional,
  IsNumber,
  MaxLength,
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
}
