import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsNotEmpty,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  MaxLength,
  Min,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PlanFeatureItemDto } from './plan-feature-item.dto';

export class CreatePromotionalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['monthly', 'quarterly', 'semiannual', 'annual', 'lifetime'])
  billing_cycle?: string;

  @IsNumber()
  @Min(0)
  base_price: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  // Same canonical ARRAY shape as CreatePlanDto.feature_matrix. The legacy
  // object shape is read-only compatibility, never written.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => PlanFeatureItemDto)
  feature_matrix?: PlanFeatureItemDto[];

  @IsOptional()
  @IsObject()
  ai_feature_flags?: Record<string, any>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  grace_period_soft_days?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  grace_period_hard_days?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  suspension_day?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cancellation_day?: number;

  @IsObject()
  promo_rules: Record<string, any>;

  @IsOptional()
  @IsNumber()
  promo_priority?: number;

  @IsOptional()
  @IsNumber()
  parent_plan_id?: number;
}
