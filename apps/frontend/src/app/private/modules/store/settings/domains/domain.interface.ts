export interface StoreDomain {
    id: number;
    hostname: string;
    domain_type: StoreDomainType;
    status: StoreDomainStatus;
    ssl_status: StoreDomainSSLStatus;
    ownership: StoreDomainOwnership;
    is_primary: boolean;
    config: StoreDomainConfig;
    verification_token?: string;
    last_verified_at?: string;
    last_error?: string;
    created_at: string;
    updated_at: string;
}

export type StoreDomainType = 'vendix_core' | 'organization' | 'store' | 'ecommerce';

export type StoreDomainStatus = 'pending_dns' | 'pending_ssl' | 'active' | 'disabled';

export type StoreDomainSSLStatus = 'none' | 'pending' | 'issued' | 'error' | 'revoked';

export type StoreDomainOwnership =
    | 'vendix_subdomain'
    | 'custom_domain'
    | 'custom_subdomain'
    | 'vendix_core'
    | 'third_party_subdomain';

export interface StoreDomainConfig {
    branding?: {
        company_name?: string;
        store_name?: string;
        logo_url?: string;
        favicon?: string;
        primary_color?: string;
        secondary_color?: string;
        accent_color?: string;
    };
    seo?: {
        title?: string;
        description?: string;
        keywords?: string[];
    };
    features?: {
        ecommerce?: boolean;
        blog?: boolean;
        support?: boolean;
        analytics?: boolean;
    };
}

export interface CreateStoreDomainDto {
    hostname: string;
    domain_type?: StoreDomainType;
    is_primary?: boolean;
    ownership?: StoreDomainOwnership;
    config: StoreDomainConfig;
}

export interface UpdateStoreDomainDto {
    domain_type?: StoreDomainType;
    status?: StoreDomainStatus;
    ssl_status?: StoreDomainSSLStatus;
    ownership?: StoreDomainOwnership;
    is_primary?: boolean;
    config?: StoreDomainConfig;
}

export interface StoreDomainQueryDto {
    page?: number;
    limit?: number;
    search?: string;
    domain_type?: StoreDomainType;
    status?: StoreDomainStatus;
}

export interface PaginatedDomainsResponse {
    success: boolean;
    data: StoreDomain[];
    meta?: {
        total: number;
        page: number;
        limit: number;
        total_pages: number;
    };
}

export interface SingleDomainResponse {
    success: boolean;
    data: StoreDomain;
    message?: string;
}
