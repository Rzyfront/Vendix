import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsDateString,
  MaxLength,
  Min,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEmployeeDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  employee_code?: string;

  @IsString()
  @MaxLength(100)
  first_name: string;

  @IsString()
  @MaxLength(100)
  last_name: string;

  @IsString()
  @MaxLength(20)
  document_type: string;

  @IsString()
  @MaxLength(50)
  document_number: string;

  @IsDateString()
  hire_date: string;

  @IsEnum(['indefinite', 'fixed_term', 'service', 'apprentice'])
  contract_type: 'indefinite' | 'fixed_term' | 'service' | 'apprentice';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  base_salary: number;

  @IsOptional()
  @IsEnum(['monthly', 'biweekly', 'weekly'])
  payment_frequency?: 'monthly' | 'biweekly' | 'weekly';

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  user_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  position?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bank_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  bank_account_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bank_account_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  health_provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  pension_fund?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  arl_risk_level?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  severance_fund?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  compensation_fund?: string;
}
