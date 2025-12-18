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
  IsObject,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

class DateRangeDto {
  @IsOptional()
  @Type(() => Date)
  start_date?: Date;

  @IsOptional()
  @Type(() => Date)
  end_date?: Date;
}

export enum OrganizationState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
}

// CreateOrganizationDto eliminado - creación de organizaciones es función de superadmin

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

// OrganizationQueryDto eliminado - listado de organizaciones es función de superadmin
// AddUserToOrganizationDto eliminado - gestión de usuarios es función del módulo users

export enum DashboardPeriod {
  SIX_MONTHS = '6m',
  ONE_YEAR = '1y',
  ALL = 'all',
}

export class OrganizationDashboardDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number; // Opcional: filtrar por tienda específica

  @IsOptional()
  @Type(() => Date)
  start_date?: Date;

  @IsOptional()
  @Type(() => Date)
  end_date?: Date;

  @IsOptional()
  @IsEnum(DashboardPeriod)
  period?: DashboardPeriod = DashboardPeriod.SIX_MONTHS;
}

// UsersDashboardDto eliminado - gestión de usuarios es función del módulo users
// AdminOrganizationQueryDto eliminado - administración de organizaciones es función de superadmin
// OrganizationsDashboardStatsDto eliminado - estadísticas globales son función de superadmin
