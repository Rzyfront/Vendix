import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateOrganizationPaymentPolicyDto {
  @IsArray()
  @IsString({ each: true })
  allowed_methods: string[];

  @IsOptional()
  default_config?: Record<string, any>;

  @IsBoolean()
  @IsOptional()
  enforce_policies?: boolean;

  @IsBoolean()
  @IsOptional()
  allow_store_overrides?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  min_order_amount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  max_order_amount?: number;
}

export class UpdateOrganizationPaymentPolicyDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowed_methods?: string[];

  @IsOptional()
  default_config?: Record<string, any>;

  @IsBoolean()
  @IsOptional()
  enforce_policies?: boolean;

  @IsBoolean()
  @IsOptional()
  allow_store_overrides?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  min_order_amount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  max_order_amount?: number;
}

export class OrganizationPaymentPolicyResponseDto {
  id: number;
  organization_id: number;
  allowed_methods: string[];
  default_config?: Record<string, any>;
  enforce_policies: boolean;
  allow_store_overrides: boolean;
  min_order_amount?: number;
  max_order_amount?: number;
  created_at: Date;
  updated_at: Date;
}
