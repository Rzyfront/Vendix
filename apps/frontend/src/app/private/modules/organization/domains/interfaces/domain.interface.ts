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
  store_id?: number;
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

export interface DomainFilters {
  search: string;
  status: DomainStatus | '';
  ownership: DomainOwnership | '';
  store_id: number | null;
}
