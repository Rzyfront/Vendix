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

export class CreateStoreDomainDto {
    @IsString()
    @IsNotEmpty()
    hostname: string;

    @IsOptional()
    @IsIn(['vendix_core', 'organization', 'store', 'ecommerce'])
    domain_type?: string;

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

    @IsObject()
    config: Record<string, any>;
}

export class UpdateStoreDomainDto {
    @IsOptional()
    @IsIn(['vendix_core', 'organization', 'store', 'ecommerce'])
    domain_type?: string;

    @IsOptional()
    @IsBoolean()
    is_primary?: boolean;

    @IsOptional()
    @IsIn(['pending_dns', 'pending_ssl', 'active', 'disabled'])
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
    @IsIn(['pending_dns', 'pending_ssl', 'active', 'disabled'])
    status?: string;
}
