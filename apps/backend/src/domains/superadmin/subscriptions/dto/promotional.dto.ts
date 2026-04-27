import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsObject,
  IsNotEmpty,
  MaxLength,
  Min,
} from 'class-validator';

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
  @IsEnum(['monthly', 'quarterly', 'semiannual', 'annual', 'lifetime'])
  billing_cycle?: string;

  @IsNumber()
  @Min(0)
  base_price: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  trial_days?: number;

  @IsOptional()
  @IsObject()
  feature_matrix?: Record<string, any>;

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
