import { IsOptional, IsEnum, IsDateString, IsString, MaxLength } from 'class-validator';

export class UpdatePayrollRunDto {
  @IsOptional()
  @IsEnum(['monthly', 'biweekly', 'weekly'])
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
