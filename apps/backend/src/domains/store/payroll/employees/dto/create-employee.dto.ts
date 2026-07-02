import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsDateString,
  IsBoolean,
  IsEmail,
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

  @IsOptional()
  @IsDateString()
  birth_date?: string;

  @IsOptional()
  @IsEnum(['male', 'female', 'other'])
  gender?: 'male' | 'female' | 'other';

  @IsDateString()
  hire_date: string;

  @IsEnum(['indefinite', 'fixed_term', 'service', 'apprentice', 'obra_labor'])
  contract_type:
    | 'indefinite'
    | 'fixed_term'
    | 'service'
    | 'apprentice'
    | 'obra_labor';

  @IsOptional()
  @IsDateString()
  contract_end_date?: string;

  @IsOptional()
  @IsEnum(['ordinary', 'integral'])
  salary_type?: 'ordinary' | 'integral';

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
  @IsEnum(['operational', 'administrative', 'sales'])
  cost_center?: 'operational' | 'administrative' | 'sales';

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

  // Contact channels — required for the inline create-employee
  // form in schedule-management (so the operator can capture them
  // at booking-creation time instead of routing through Payroll
  // later). Friendlier Spanish messages replace the default
  // class-validator copy so the operator understands the failure.
  @IsString({ message: 'El correo es obligatorio' })
  @IsEmail({}, { message: 'El correo debe tener un formato válido (ej: usuario@empresa.com)' })
  email: string;

  @IsString({ message: 'El teléfono es obligatorio' })
  @MaxLength(20, { message: 'El teléfono no puede exceder 20 caracteres' })
  phone: string;

  @IsOptional()
  @IsBoolean()
  associate_if_exists?: boolean;
}
