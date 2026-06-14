import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsDateString,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  @Min(0)
  debit_amount: number;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  credit_amount: number;
}

export class CreateJournalEntryDto {
  @IsNumber()
  @Type(() => Number)
  fiscal_period_id: number;

  @IsDateString()
  entry_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(2)
  @Type(() => CreateEntryLineDto)
  lines: CreateEntryLineDto[];
}
