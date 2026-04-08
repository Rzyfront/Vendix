import {
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreatePayrollDefaultsDto {
  @IsInt()
  @Min(2020)
  year: number;

  // Employee deductions
  @IsNumber()
  @Min(0)
  @Max(1)
  health_employee_rate: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  pension_employee_rate: number;

  // Employer contributions
  @IsNumber()
  @Min(0)
  @Max(1)
  health_employer_rate: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  pension_employer_rate: number;

  @IsObject()
  arl_rates: Record<number, number>;

  @IsNumber()
  @Min(0)
  @Max(1)
  sena_rate: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  icbf_rate: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  compensation_fund_rate: number;

  // Annual values
  @IsNumber()
  @Min(0)
  minimum_wage: number;

  @IsNumber()
  @Min(0)
  transport_subsidy: number;

  // Thresholds
  @IsNumber()
  @Min(0)
  transport_subsidy_threshold: number;

  @IsNumber()
  @Min(0)
  retention_exempt_threshold: number;

  // Provisions
  @IsNumber()
  @Min(0)
  @Max(1)
  severance_rate: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  severance_interest_rate: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  vacation_rate: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  bonus_rate: number;

  @IsOptional()
  @IsString()
  decree_ref?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
