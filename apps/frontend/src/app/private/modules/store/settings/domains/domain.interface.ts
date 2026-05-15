export interface StoreDomain {
    id: number;
    hostname: string;
    app_type: StoreDomainAppType;
    domain_type: StoreDomainType;
    status: StoreDomainStatus;
    ssl_status: StoreDomainSSLStatus;
    ownership: StoreDomainOwnership;
    is_primary: boolean;
    config: StoreDomainConfig;
    verification_token?: string;
    last_verified_at?: string;
    validation_cname_name?: string;
    validation_cname_value?: string;
    acm_certificate_arn?: string;
    certificate_requested_at?: string;
    certificate_issued_at?: string;
    cloudfront_distribution_id?: string;
    cloudfront_alias_added_at?: string;
    cloudfront_deployed_at?: string;
    last_error?: string;
    wildcard_ssl_status?: 'pending' | 'issued' | 'upgrade_required' | 'not_applicable' | 'error' | string;
    ssl_inherited_from_hostname?: string | null;
    created_at: string;
    updated_at: string;
}

export type StoreDomainType = 'vendix_core' | 'organization' | 'store' | 'ecommerce';

export type StoreDomainAppType = 'STORE_ECOMMERCE' | 'STORE_LANDING' | 'STORE_ADMIN';

export type StoreDomainStatus =
    | 'pending_dns'
    | 'pending_ssl'
    | 'active'
    | 'disabled'
    | 'pending_ownership'
    | 'verifying_ownership'
    | 'pending_certificate'
    | 'issuing_certificate'
    | 'pending_alias'
    | 'propagating'
    | 'failed_ownership'
    | 'failed_certificate'
    | 'failed_alias';

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
    ssl?: {
        inherited?: boolean;
        inherited_from_domain_id?: number;
        inherited_from_hostname?: string;
        wildcard_hostname?: string | null;
        wildcard_status?: string;
        certificate_status?: string;
        aws_certificate_status?: string;
        cloudfront_status?: string;
        https_probe_status?: 'pending' | 'passed' | 'failed';
        routing_target?: string;
        routing_target_type?: 'cloudfront_distribution' | 'legacy_edge_alias';
        last_probe_at?: string;
        next_check_at?: string | null;
        validation_records?: Array<{
            domain_name?: string;
            record_type: string;
            name: string;
            value: string;
            validation_status?: string;
        }>;
        cloudfront_aliases?: string[];
    };
}

export interface CreateStoreDomainDto {
    hostname: string;
    domain_type?: StoreDomainType;
    app_type?: StoreDomainAppType;
    is_primary?: boolean;
    ownership?: StoreDomainOwnership;
    config: StoreDomainConfig;
}

export interface UpdateStoreDomainDto {
    domain_type?: StoreDomainType;
    app_type?: StoreDomainAppType;
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
    app_type?: StoreDomainAppType;
    status?: StoreDomainStatus;
}

export interface DnsInstructionRecord {
    record_type: string;
    name: string;
    value: string;
    ttl: number;
    purpose?: 'ownership' | 'routing' | 'certificate' | string;
    group?: 'ownership' | 'routing' | 'certificate';
    status?: 'pending' | 'complete' | 'not_required' | 'covered_by_parent' | string;
    scope?: 'root' | 'wildcard' | 'subdomain' | 'parent' | string;
    covered_by_parent_hostname?: string;
    domain_name?: string;
    provider_host?: string;
    fqdn_name?: string;
    detected_values?: string[];
    seen_in?: string[];
    status_reason?: string;
    routing_target_type?: 'cloudfront_distribution' | 'legacy_edge_alias';
}

export interface DomainProvisioningStage {
    key: 'ownership' | 'certificate' | 'routing' | 'cloudfront' | 'https' | 'active' | 'failed' | string;
    label: string;
    status: 'pending' | 'waiting' | 'complete' | 'failed' | 'covered_by_parent' | 'not_required' | string;
    detail: string;
    waiting: boolean;
    updated_at?: string;
}

export interface DnsInstructions {
    hostname: string;
    ownership: StoreDomainOwnership;
    dns_type: 'CNAME' | 'A';
    target: string;
    requires_alias?: boolean;
    ownership_status?: 'pending' | 'complete' | 'not_required' | 'covered_by_parent' | string;
    certificate_status?: 'pending' | 'complete' | 'not_required' | 'covered_by_parent' | string;
    routing_status?: 'pending' | 'complete' | 'not_required' | 'covered_by_parent' | string;
    wildcard_hostname?: string;
    covered_by_parent_hostname?: string | null;
    provisioning_stage?: 'ownership' | 'certificate' | 'routing' | 'cloudfront' | 'https' | 'active' | 'failed' | string;
    stages?: DomainProvisioningStage[];
    aws_certificate_status?: string;
    cloudfront_status?: string;
    https_probe_status?: 'pending' | 'passed' | 'failed';
    next_check_at?: string;
    instructions: DnsInstructionRecord[];
}

export interface VerifyDomainResult {
    hostname: string;
    status_before: StoreDomainStatus;
    status_after: StoreDomainStatus;
    ssl_status: StoreDomainSSLStatus;
    verified: boolean;
    checks: Record<string, { valid: boolean; reason?: string; records?: string[]; name?: string; expected?: string }>;
    suggested_fixes?: string[];
    timestamp: string;
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

export interface DnsInstructionsResponse {
    success: boolean;
    data: DnsInstructions;
    message?: string;
}

export interface VerifyDomainResponse {
    success: boolean;
    data: VerifyDomainResult;
    message?: string;
}
