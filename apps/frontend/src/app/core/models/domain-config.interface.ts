export enum DomainType {
  VENDIX_CORE = 'vendix_core',
  ORGANIZATION = 'organization',
  STORE = 'store',
  ECOMMERCE = 'ecommerce'
}

export enum AppEnvironment {
  VENDIX_LANDING = 'VENDIX_LANDING',
  VENDIX_ADMIN = 'VENDIX_ADMIN',
  ORG_LANDING = 'ORG_LANDING',
  ORG_ADMIN = 'ORG_ADMIN',
  STORE_ADMIN = 'STORE_ADMIN',
  STORE_ECOMMERCE = 'STORE_ECOMMERCE'
}

export interface DomainConfig {
  domainType: DomainType;
  environment: AppEnvironment;
  organization_slug?: string;
  store_slug?: string;
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
  raw_domain_type: 'vendix_core' | 'organization' | 'store' | 'ecommerce';
  status: string;
  ssl_status: string;
  is_primary: boolean;
  store_slug?: string;
}
