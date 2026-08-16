import {
  IsOptional,
  IsDateString,
  IsString,
  MaxLength,
  IsIn,
} from 'class-validator';

export class UpdatePayrollRunDto {
  @IsOptional()
  @IsIn(['monthly', 'biweekly', 'weekly'])
  frequency?: 'monthly' | 'biweekly' | 'weekly';

  @IsOptional()
  @IsDateString()
  period_start?: string;

  @IsOptional()
  @IsDateString()
  period_end?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  payroll_number?: string;
}
