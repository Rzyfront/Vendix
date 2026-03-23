import { IsNumber, IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSettlementDto {
  @IsNumber()
  @Type(() => Number)
  employee_id: number;

  @IsDateString()
  termination_date: string;

  @IsEnum([
    'voluntary_resignation',
    'just_cause',
    'without_just_cause',
    'mutual_agreement',
    'contract_expiry',
    'retirement',
    'death',
  ])
  termination_reason: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  pending_salary_days?: number = 0;
}
