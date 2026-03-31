import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsObject,
  Min,
} from 'class-validator';

export enum CommissionRuleType {
  PAYMENT_METHOD = 'payment_method',
  VOLUME = 'volume',
  CATEGORY = 'category',
  CUSTOM = 'custom',
}

export enum CommissionCalcType {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage',
  TIERED = 'tiered',
}

export class CreateCommissionRuleDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(CommissionRuleType)
  rule_type: CommissionRuleType;

  @IsObject()
  conditions: Record<string, any>;

  @IsEnum(CommissionCalcType)
  commission_type: CommissionCalcType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsObject()
  tiers?: any;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsDateString()
  valid_from?: string;

  @IsOptional()
  @IsDateString()
  valid_to?: string;
}
