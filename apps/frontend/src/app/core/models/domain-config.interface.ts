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
  id: string;
  hostname: string;
  raw_domain_type?: 'organization_root' | 'organization_subdomain' | 'store_subdomain' | 'store_custom';
  domainType?: string; // Alternative field used by API
  purpose?: 'landing' | 'admin' | 'ecommerce';
  app?: string; // App environment identifier (VENDIX_LANDING, VENDIX_ADMIN, etc.)
  organizationId: string;
  organizationSlug: string;
  storeId?: string;
  storeSlug?: string;
  config: any;
  environmentConfig?: {
    showLanding?: boolean;
    defaultStore?: string;
    redirectRules?: any[];
  };
  isActive: boolean;
  sslEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}
