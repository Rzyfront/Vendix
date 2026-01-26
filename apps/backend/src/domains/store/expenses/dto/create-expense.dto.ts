import {
  IsString,
  IsNumber,
  IsDate,
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

  @IsDate()
  @Type(() => Date)
  expense_date: Date;

  @IsOptional()
  @IsUrl()
  receipt_url?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
