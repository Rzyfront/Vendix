import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  MaxLength,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePayrollRunDto {
  @IsEnum(['monthly', 'biweekly', 'weekly'])
  frequency: 'monthly' | 'biweekly' | 'weekly';

  @IsDateString()
  period_start: string;

  @IsDateString()
  period_end: string;

  @IsOptional()
  @IsDateString()
  payment_date?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  payroll_number?: string;
}
