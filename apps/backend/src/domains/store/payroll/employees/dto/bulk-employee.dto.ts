import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  ValidateNested,
  IsNotEmpty,
  MaxLength,
  Min,
  IsEmail,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class BulkEmployeeItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  first_name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  last_name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  document_type: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  document_number: string;

  @IsString()
  @IsNotEmpty()
  hire_date: string;

  @IsString()
  @IsNotEmpty()
  contract_type: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  base_salary: number;

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
  @MaxLength(20)
  cost_center?: string;

  @IsOptional()
  @IsString()
  payment_frequency?: string;

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
  @IsNumber()
  @Min(1)
  @Max(5)
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

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.toLowerCase() === 'si' || value.toLowerCase() === 'yes' || value.toLowerCase() === 'true';
    }
    return !!value;
  })
  is_user?: boolean;

  @IsOptional()
  @IsEmail({}, { message: 'Email inválido' })
  @Transform(({ value }) => (value === '' ? undefined : value))
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}

export class BulkEmployeeUploadDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkEmployeeItemDto)
  employees: BulkEmployeeItemDto[];
}

export class BulkEmployeeItemResultDto {
  employee: any;
  status: 'success' | 'error';
  message: string;
  error?: string;
  user_created?: boolean;
  user_linked?: boolean;
}

export class BulkEmployeeUploadResultDto {
  success: boolean;
  total_processed: number;
  successful: number;
  failed: number;
  users_created: number;
  users_linked: number;
  results: BulkEmployeeItemResultDto[];
}
