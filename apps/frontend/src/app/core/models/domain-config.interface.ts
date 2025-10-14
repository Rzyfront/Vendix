export enum DomainType {
  VENDIX_CORE = 'vendix_core',
  ORGANIZATION_ROOT = 'organization_root',
  ORGANIZATION_SUBDOMAIN = 'org_subdomain',
  STORE_SUBDOMAIN = 'store_subdomain',
  STORE_CUSTOM = 'store_custom'
}

export enum AppEnvironment {
  VENDIX_LANDING = 'vendix_landing',
  VENDIX_ADMIN = 'vendix_admin',
  ORG_LANDING = 'org_landing',
  ORG_ADMIN = 'org_admin',
  STORE_ADMIN = 'store_admin',
  STORE_ECOMMERCE = 'store_ecommerce'
}

export interface DomainConfig {
  domainType: DomainType;
  environment: AppEnvironment;
  organizationSlug?: string;
  storeSlug?: string;
  customConfig?: any;
  isVendixDomain: boolean;
  hostname: string;
}

export interface DomainResolution {
  id: number;
  hostname: string;
  organization_id: number;
  config: {
    app: string;
    branding?: any;
    security?: any;
  };
  created_at: string;
  updated_at: string;
  organization_name: string;
  organization_slug: string;
  domain_type: string;
  raw_domain_type: 'organization_root' | 'organization_subdomain' | 'store_subdomain' | 'store_custom';
  status: string;
  ssl_status: string;
  is_primary: boolean;
  store_slug?: string;
}
