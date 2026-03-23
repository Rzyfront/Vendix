import {
  IsNumber,
  IsString,
  IsOptional,
  Min,
  IsInt,
  IsIn,
  MaxLength,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAdvanceDto {
  @IsNumber()
  @Type(() => Number)
  employee_id: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount_requested: number;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  installments: number = 1;

  @IsOptional()
  @IsIn(['monthly', 'biweekly', 'weekly'])
  frequency?: 'monthly' | 'biweekly' | 'weekly';

  @IsDateString()
  advance_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
