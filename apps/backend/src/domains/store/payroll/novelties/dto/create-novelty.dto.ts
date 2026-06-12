import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const NOVELTY_TYPES = [
  'overtime_diurna',
  'overtime_nocturna',
  'overtime_dominical_diurna',
  'overtime_dominical_nocturna',
  'surcharge_nocturno',
  'surcharge_dominical',
  'incapacity_general',
  'incapacity_laboral',
  'vacation',
  'leave_paid',
  'leave_unpaid',
  'bonus',
  'commission',
  'other_deduction',
] as const;

export type NoveltyType = (typeof NOVELTY_TYPES)[number];

export class CreateNoveltyDto {
  @IsInt()
  @Type(() => Number)
  employee_id: number;

  @IsIn(NOVELTY_TYPES)
  novelty_type: NoveltyType;

  @IsDateString()
  date_start: string;

  @IsOptional()
  @IsDateString()
  date_end?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  hours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  days?: number;

  /** Optional rate override expressed as a decimal (0.25 = 25%). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  percentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
