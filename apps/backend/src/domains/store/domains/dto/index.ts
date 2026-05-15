import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsObject,
  IsIn,
  IsNumber,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

const DOMAIN_STATUSES = [
  'pending_dns',
  'pending_ssl',
  'active',
  'disabled',
  'pending_ownership',
  'verifying_ownership',
  'pending_certificate',
  'issuing_certificate',
  'pending_alias',
  'propagating',
  'failed_ownership',
  'failed_certificate',
  'failed_alias',
];

const STORE_APP_TYPES = ['STORE_ECOMMERCE', 'STORE_LANDING', 'STORE_ADMIN'];

export class CreateStoreDomainDto {
  @IsString()
  @IsNotEmpty()
  hostname: string;

  @IsOptional()
  @IsIn(['vendix_core', 'organization', 'store', 'ecommerce'])
  domain_type?: string;

  @IsOptional()
  @IsIn(STORE_APP_TYPES)
  app_type?: string;

  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @IsOptional()
  @IsIn([
    'vendix_subdomain',
    'custom_domain',
    'custom_subdomain',
    'vendix_core',
    'third_party_subdomain',
  ])
  ownership?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  domain_root_id?: number;

  @IsObject()
  config: Record<string, any>;
}

export class CreateDomainRootDto {
  @IsString()
  @IsNotEmpty()
  hostname: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}

export class CreateDomainRootAssignmentDto {
  @IsString()
  @IsNotEmpty()
  hostname: string;

  @IsOptional()
  @IsIn(['vendix_core', 'organization', 'store', 'ecommerce'])
  domain_type?: string;

  @IsOptional()
  @IsIn(STORE_APP_TYPES)
  app_type?: string;

  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}

export class UpdateStoreDomainDto {
  @IsOptional()
  @IsIn(['vendix_core', 'organization', 'store', 'ecommerce'])
  domain_type?: string;

  @IsOptional()
  @IsIn(STORE_APP_TYPES)
  app_type?: string;

  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @IsOptional()
  @IsIn(DOMAIN_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(['none', 'pending', 'issued', 'error', 'revoked'])
  ssl_status?: string;

  @IsOptional()
  @IsIn([
    'vendix_subdomain',
    'custom_domain',
    'custom_subdomain',
    'vendix_core',
    'third_party_subdomain',
  ])
  ownership?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}

export class StoreDomainQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['vendix_core', 'organization', 'store', 'ecommerce'])
  domain_type?: string;

  @IsOptional()
  @IsIn(DOMAIN_STATUSES)
  status?: string;
}
