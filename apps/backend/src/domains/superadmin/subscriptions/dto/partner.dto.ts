import {
  IsNumber,
  IsOptional,
  IsBoolean,
  IsString,
  IsObject,
  IsInt,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TogglePartnerDto {
  @IsNumber()
  organization_id: number;

  @IsBoolean()
  is_partner: boolean;
}

export class SetMarginCapDto {
  @IsNumber()
  organization_id: number;

  @IsNumber()
  @Min(0)
  max_partner_margin_pct: number;
}

export class CreatePartnerOverrideDto {
  @IsNumber()
  organization_id: number;

  @IsNumber()
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
  @Min(0)
  margin_pct: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fixed_surcharge?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  feature_overrides?: Record<string, any>;
}

export class UpdatePartnerOverrideDto {
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

  @IsOptional()
  @IsNumber()
  @Min(0)
  margin_pct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fixed_surcharge?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  feature_overrides?: Record<string, any>;
}

export class PartnerQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  is_partner?: boolean;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';
}
