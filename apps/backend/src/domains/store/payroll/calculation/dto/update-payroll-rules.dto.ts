import {
  IsOptional,
  IsNumber,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OvertimeRates } from '../interfaces/payroll-rules.interface';

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

  // Novelty valuation (optional — global ValidationPipe uses
  // forbidNonWhitelisted, so these keys must be whitelisted to allow
  // GET → PATCH round-trips of the rules object)
  @IsOptional()
  @IsNumber()
  @Min(1)
  monthly_hours?: number;

  @IsOptional()
  overtime_rates?: OvertimeRates;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  incapacity_general_employer_rate?: number;
}
