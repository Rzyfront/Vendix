import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsObject,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PlanPricingDto {
  @IsEnum(['monthly', 'quarterly', 'semiannual', 'annual'])
  billing_cycle: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsBoolean()
  is_default: boolean;
}

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
  @IsBoolean()
  is_free?: boolean;

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

  @IsOptional()
  @IsObject()
  feature_matrix?: Record<string, any>;

  @IsOptional()
  @IsObject()
  ai_feature_flags?: Record<string, any>;

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
  @IsString()
  @MaxLength(64)
  redemption_code?: string | null;

  @IsOptional()
  @IsObject()
  promo_rules?: Record<string, any>;

  @IsOptional()
  @IsNumber()
  promo_priority?: number;

  @IsOptional()
  @IsBoolean()
  is_popular?: boolean;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsNumber()
  sort_order?: number;

  @IsOptional()
  @IsNumber()
  parent_plan_id?: number;

  // --- Multi-cycle support (additive) ---
  // When provided with >= 1 item, create() produces one subscription_plans row
  // per pricing, all sharing the same plan_group_code.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanPricingDto)
  pricings?: PlanPricingDto[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  plan_group_code?: string;

  @IsOptional()
  @IsString()
  details_md?: string;
}
