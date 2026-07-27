import {
  IsString,
  IsNumber,
  IsDateString,
  IsOptional,
  MaxLength,
  IsDecimal,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ExpenseLineItemDto {
  @IsString()
  @MaxLength(500)
  description: string;

  @IsNumber()
  @Type(() => Number)
  quantity: number;

  @IsNumber()
  @Type(() => Number)
  unit_price: number;

  @IsNumber()
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  line_index?: number;
}

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
  @IsString()
  receipt_url?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpenseLineItemDto)
  items?: ExpenseLineItemDto[];
}
