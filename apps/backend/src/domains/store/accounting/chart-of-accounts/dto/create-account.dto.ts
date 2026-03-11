import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum AccountTypeEnum {
  ASSET = 'asset',
  LIABILITY = 'liability',
  EQUITY = 'equity',
  REVENUE = 'revenue',
  EXPENSE = 'expense',
}

export enum AccountNatureEnum {
  DEBIT = 'debit',
  CREDIT = 'credit',
}

export class CreateAccountDto {
  @IsString()
  @MaxLength(20)
  code: string;

  @IsString()
  @MaxLength(255)
  name: string;

  @IsEnum(AccountTypeEnum)
  account_type: AccountTypeEnum;

  @IsEnum(AccountNatureEnum)
  nature: AccountNatureEnum;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  parent_id?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;

  @IsOptional()
  @IsBoolean()
  accepts_entries?: boolean = false;
}
