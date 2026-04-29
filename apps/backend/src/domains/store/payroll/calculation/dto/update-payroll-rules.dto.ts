import {
  IsOptional,
  IsNumber,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePayrollRulesDto {
  // Employee deductions
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  health_employee_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  pension_employee_rate?: number;

  // Employer contributions
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  health_employer_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  pension_employer_rate?: number;

  @IsOptional()
  arl_rates?: Record<number, number>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  sena_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  icbf_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  compensation_fund_rate?: number;

  // Annual values
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimum_wage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  transport_subsidy?: number;

  // Thresholds
  @IsOptional()
  @IsNumber()
  @Min(0)
  transport_subsidy_threshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  retention_exempt_threshold?: number;

  // Provisions
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  severance_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  severance_interest_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  vacation_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  bonus_rate?: number;
}
