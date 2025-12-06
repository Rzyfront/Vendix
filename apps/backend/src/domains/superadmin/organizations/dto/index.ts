import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsUrl,
  MaxLength,
  MinLength,
  IsInt,
  IsBoolean,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum OrganizationState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
}

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  legal_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tax_id?: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(255)
  website?: string;

  @IsOptional()
  @IsUrl()
  logo_url?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(OrganizationState)
  state?: OrganizationState = OrganizationState.ACTIVE;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  legal_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tax_id?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(255)
  website?: string;

  @IsOptional()
  @IsUrl()
  logo_url?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(OrganizationState)
  state?: OrganizationState;
}

export class AdminOrganizationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(OrganizationState)
  status?: OrganizationState;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';
}

export class OrganizationsDashboardStatsDto {
  total_organizations: number;
  active: number;
  inactive: number;
  suspended: number;
}

export class OrganizationDashboardDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @Type(() => Date)
  start_date?: Date;

  @IsOptional()
  @Type(() => Date)
  end_date?: Date;

  @IsOptional()
  @IsString()
  period?: string = '6m';
}
