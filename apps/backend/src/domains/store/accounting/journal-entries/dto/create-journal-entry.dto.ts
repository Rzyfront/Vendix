import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsDateString,
  IsEnum,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum EntryTypeEnum {
  MANUAL = 'manual',
  AUTO_INVOICE = 'auto_invoice',
  AUTO_PAYMENT = 'auto_payment',
  AUTO_EXPENSE = 'auto_expense',
  AUTO_PAYROLL = 'auto_payroll',
}

export class CreateEntryLineDto {
  @IsNumber()
  @Type(() => Number)
  account_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsNumber()
  @Type(() => Number)
  debit_amount: number;

  @IsNumber()
  @Type(() => Number)
  credit_amount: number;
}

export class CreateJournalEntryDto {
  @IsOptional()
  @IsEnum(EntryTypeEnum)
  entry_type?: EntryTypeEnum = EntryTypeEnum.MANUAL;

  @IsNumber()
  @Type(() => Number)
  fiscal_period_id: number;

  @IsDateString()
  entry_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  source_type?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  source_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  store_id?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(2)
  @Type(() => CreateEntryLineDto)
  lines: CreateEntryLineDto[];
}
