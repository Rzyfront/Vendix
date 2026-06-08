import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export type SubscriptionFiscalEnvironment = 'test' | 'production';

export class UpsertSubscriptionFiscalConfigDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  platform_organization_id!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  accounting_entity_id!: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  invoice_resolution_id?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  dian_configuration_id?: number;

  @IsString()
  name!: string;

  @IsString()
  nit!: string;

  @IsOptional()
  @IsString()
  nit_dv?: string;

  @IsString()
  software_id!: string;

  @IsOptional()
  @IsString()
  software_pin?: string;

  @IsOptional()
  @IsString()
  test_set_id?: string;

  @IsIn(['test', 'production'])
  environment!: SubscriptionFiscalEnvironment;

  @IsBoolean()
  is_enabled!: boolean;

  @IsBoolean()
  auto_issue!: boolean;

  @IsOptional()
  @IsBoolean()
  confirm_production?: boolean;
}

export class SubscriptionFiscalQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsIn(['test', 'production'])
  environment?: SubscriptionFiscalEnvironment;

  @IsOptional()
  @IsString()
  search?: string;
}

export class RetrySubscriptionFiscalDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
