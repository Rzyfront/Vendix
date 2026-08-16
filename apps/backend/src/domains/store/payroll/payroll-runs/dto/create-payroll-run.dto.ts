import {
  IsString,
  IsOptional,
  IsDateString,
  MaxLength,
  IsInt,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePayrollRunDto {
  @IsIn(['monthly', 'biweekly', 'weekly'])
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
