import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsObject,
  IsNotEmpty,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePlanDto {
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
  @IsEnum(['base', 'partner_custom', 'promotional'])
  plan_type?: string;

  @IsOptional()
  @IsEnum(['draft', 'active', 'archived'])
  state?: string;

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
  setup_fee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  trial_days?: number;

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
  feature_matrix: Record<string, any>;

  @IsObject()
  ai_feature_flags: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  resellable?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  max_partner_margin_pct?: number;

  @IsOptional()
  @IsBoolean()
  is_promotional?: boolean;

  @IsOptional()
  @IsObject()
  promo_rules?: Record<string, any>;

  @IsOptional()
  @IsNumber()
  promo_priority?: number;

  @IsOptional()
  @IsNumber()
  parent_plan_id?: number;
}
