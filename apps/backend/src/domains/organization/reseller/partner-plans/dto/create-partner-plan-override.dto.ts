import {
  IsInt,
  IsOptional,
  IsString,
  IsNumber,
  MaxLength,
  IsBoolean,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePartnerPlanOverrideDto {
  @IsInt()
  @Type(() => Number)
  base_plan_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  custom_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  custom_name?: string;

  @IsOptional()
  @IsString()
  custom_description?: string;

  @IsNumber()
  @Type(() => Number)
  margin_pct: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  fixed_surcharge?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  feature_overrides?: Record<string, any>;
}
