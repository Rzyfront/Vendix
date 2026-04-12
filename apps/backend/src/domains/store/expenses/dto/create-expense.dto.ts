import {
  IsString,
  IsNumber,
  IsDateString,
  IsOptional,
  MaxLength,
  IsDecimal,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExpenseDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  category_id?: number;

  @IsNumber()
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsDateString()
  expense_date: string;

  @IsOptional()
  @IsUrl()
  receipt_url?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
