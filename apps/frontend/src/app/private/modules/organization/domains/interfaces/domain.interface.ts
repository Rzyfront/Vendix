// Enums from backend Prisma schema
export enum AppType {
  VENDIX_LANDING = 'VENDIX_LANDING',
  VENDIX_ADMIN = 'VENDIX_ADMIN',
  ORG_LANDING = 'ORG_LANDING',
  ORG_ADMIN = 'ORG_ADMIN',
  STORE_LANDING = 'STORE_LANDING',
  STORE_ADMIN = 'STORE_ADMIN',
  STORE_ECOMMERCE = 'STORE_ECOMMERCE',
}

export enum DomainType {
  VENDIX_CORE = 'vendix_core',
  ORGANIZATION = 'organization',
  STORE = 'store',
  ECOMMERCE = 'ecommerce',
}

export enum DomainOwnership {
  VENDIX_SUBDOMAIN = 'vendix_subdomain',
  CUSTOM_DOMAIN = 'custom_domain',
  CUSTOM_SUBDOMAIN = 'custom_subdomain',
  VENDIX_CORE = 'vendix_core',
  THIRD_PARTY_SUBDOMAIN = 'third_party_subdomain',
}

export enum DomainStatus {
  PENDING_DNS = 'pending_dns',
  PENDING_SSL = 'pending_ssl',
  PENDING_OWNERSHIP = 'pending_ownership',
  VERIFYING_OWNERSHIP = 'verifying_ownership',
  PENDING_CERTIFICATE = 'pending_certificate',
  ISSUING_CERTIFICATE = 'issuing_certificate',
  PENDING_ALIAS = 'pending_alias',
  PROPAGATING = 'propagating',
  FAILED_OWNERSHIP = 'failed_ownership',
  FAILED_CERTIFICATE = 'failed_certificate',
  FAILED_ALIAS = 'failed_alias',
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

export enum SslStatus {
  NONE = 'none',
  PENDING = 'pending',
  ISSUED = 'issued',
  ERROR = 'error',
  REVOKED = 'revoked',
}

// Main Domain interface
export interface Domain {
  id: number;
  hostname: string;
  organization_id: number | null;
  store_id: number | null;
  app_type: AppType | null;
  domain_type: DomainType;
  ownership: DomainOwnership;
  status: DomainStatus;
  ssl_status: SslStatus;
  is_primary: boolean;
  config: DomainConfig | null;
  verification_token: string | null;
  last_verified_at: string | null;
  validation_cname_name?: string | null;
  validation_cname_value?: string | null;
  acm_certificate_arn?: string | null;
  certificate_requested_at?: string | null;
  certificate_issued_at?: string | null;
  cloudfront_distribution_id?: string | null;
  cloudfront_alias_added_at?: string | null;
  cloudfront_deployed_at?: string | null;
  wildcard_ssl_status?: string | null;
  ssl_inherited_from_hostname?: string | null;
  created_at: string;
  updated_at: string;
  organization?: {
    id: number;
    name: string;
    slug: string;
  };
  store?: {
    id: number;
    name: string;
    slug: string;
  };
}

export interface DomainConfig {
  branding?: BrandingConfig;
  seo?: SeoConfig;
  features?: FeaturesConfig;
  theme?: ThemeConfig;
  ecommerce?: EcommerceConfig;
  integrations?: IntegrationsConfig;
  security?: SecurityConfig;
  performance?: PerformanceConfig;
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

export interface BrandingConfig {
  company_name?: string;
  store_name?: string;
  logo_url?: string;
  favicon?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
}

export interface SeoConfig {
  title?: string;
  description?: string;
  keywords?: string[];
  og_image?: string;
  og_type?: string;
  robots?: string;
  canonical_url?: string;
}

export interface FeaturesConfig {
  multi_store?: boolean;
  user_management?: boolean;
  analytics?: boolean;
  custom_domain?: boolean;
  inventory?: boolean;
  pos?: boolean;
  orders?: boolean;
  customers?: boolean;
  guest_checkout?: boolean;
  wishlist?: boolean;
  reviews?: boolean;
  coupons?: boolean;
  shipping?: boolean;
  payments?: boolean;
  api_access?: boolean;
  webhooks?: boolean;
  custom_themes?: boolean;
  advanced_analytics?: boolean;
}

export interface ThemeConfig {
  layout?: 'sidebar' | 'topbar' | 'minimal';
  sidebar_mode?: 'expanded' | 'collapsed' | 'overlay';
  color_scheme?: 'light' | 'dark' | 'auto';
  border_radius?: string;
  font_family?: string;
  custom_css?: string;
}

export interface EcommerceConfig {
  currency?: string;
  locale?: string;
  timezone?: string;
  tax_calculation?: 'manual' | 'automatic' | 'disabled';
  shipping_enabled?: boolean;
  digital_products_enabled?: boolean;
  subscriptions_enabled?: boolean;
}

export interface IntegrationsConfig {
  google_analytics?: string;
  google_tag_manager?: string;
  facebook_pixel?: string;
  hotjar?: string;
  intercom?: string;
  crisp?: string;
}

export interface SecurityConfig {
  force_https?: boolean;
  hsts?: boolean;
  content_security_policy?: string;
  allowed_origins?: string[];
}

export interface PerformanceConfig {
  cache_ttl?: number;
  cdn_enabled?: boolean;
  compression_enabled?: boolean;
  image_lazy_loading?: boolean;
}

// Stats interface
export interface DomainStats {
  total: number;
  active: number;
  pending: number;
  verified: number;
  platformSubdomains: number;
  customDomains: number;
  clientSubdomains: number;
  aliasDomains: number;
}

// DTOs
export interface CreateDomainDto {
  hostname: string;
  store_id?: number;
  app_type?: AppType;
  domain_type?: DomainType;
  ownership?: DomainOwnership;
  is_primary?: boolean;
  config?: DomainConfig;
}

export interface UpdateDomainDto {
  app_type?: AppType;
  domain_type?: DomainType;
  status?: DomainStatus;
  ownership?: DomainOwnership;
  is_primary?: boolean;
  config?: DomainConfig;
}

export interface DomainQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  status?: DomainStatus;
  ownership?: DomainOwnership;
  store_id?: number | '__organization__';
}

export interface VerifyDomainResult {
  hostname: string;
  status_before: string;
  status_after: string;
  ssl_status: string;
  verified: boolean;
  next_action?: string;
  checks: Record<string, DnsCheckResult>;
  suggested_fixes?: string[];
  timestamp: string;
  error_code?: string;
}

export interface DnsCheckResult {
  valid: boolean;
  reason?: string;
  records?: string[];
}

export interface DnsInstruction {
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
  ownership: string;
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
  instructions: DnsInstruction[];
}

export interface DomainFilters {
  search: string;
  status: DomainStatus | '';
  ownership: DomainOwnership | '';
  store_id: number | null;
}
