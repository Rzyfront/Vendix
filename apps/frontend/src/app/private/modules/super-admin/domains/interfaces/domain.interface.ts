export enum DomainType {
  PRIMARY = 'primary',
  ALIAS = 'alias',
  CUSTOMER = 'customer',
}

export enum DomainStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
  VERIFIED = 'verified',
  FAILED = 'failed',
}

export interface Domain {
  id: number;
  hostname: string;
  domain_type: DomainType;
  status: DomainStatus;
  organization_id: number;
  store_id?: number;
  config: DomainConfig;
  ssl_certificate?: string;
  ssl_expires_at?: string;
  verified_at?: string;
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
  branding: {
    primary_color: string;
    secondary_color?: string;
    accent_color?: string;
    theme: 'light' | 'dark' | 'auto';
    logo_url?: string;
    favicon_url?: string;
    font_family?: string;
  };
  features: {
    ecommerce: boolean;
    blog: boolean;
    support: boolean;
    analytics: boolean;
  };
  seo: {
    title?: string;
    description?: string;
    keywords?: string[];
  };
  social: {
    facebook?: string;
    twitter?: string;
    instagram?: string;
    linkedin?: string;
  };
}

export interface DomainListItem {
  id: number;
  hostname: string;
  domain_type: DomainType;
  status: DomainStatus;
  organization_id: number;
  store_id?: number;
  organization: {
    id: number;
    name: string;
    slug: string;
  };
  store?: {
    id: number;
    name: string;
    slug: string;
  };
  created_at: string;
  updated_at: string;
}

export interface DomainDetails extends Domain {
  stats: {
    total_visits: number;
    unique_visitors: number;
    conversion_rate: number;
    average_session_duration: number;
  };
  recent_activity: Array<{
    id: number;
    action: string;
    timestamp: string;
    user: {
      name: string;
      email: string;
    };
  }>;
}

export interface CreateDomainDto {
  hostname: string;
  domain_type: DomainType;
  organization_id: number;
  store_id?: number;
  config: {
    branding: {
      primary_color: string;
      theme: 'light' | 'dark' | 'auto';
    };
  };
}

export interface UpdateDomainDto {
  hostname?: string;
  domain_type?: DomainType;
  status?: DomainStatus;
  config?: Partial<DomainConfig>;
}

export interface DomainQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  domain_type?: DomainType;
  status?: DomainStatus;
  organization_id?: number;
}

export interface DomainFilters {
  search: string;
  domain_type: DomainType;
  status: DomainStatus;
  organization_id: number;
  dateRange: {
    start: Date;
    end: Date;
  };
}

export interface DomainTableColumn {
  key: string;
  label: string;
  sortable: boolean;
  width?: string;
}

export interface DomainTableAction {
  label: string;
  icon: string;
  action: (domain: DomainListItem) => void;
  disabled?: (domain: DomainListItem) => boolean;
  danger?: boolean;
}

export interface DomainStats {
  // Backend response uses camelCase
  totalDomains: number;
  activeDomains: number;
  pendingDomains: number;
  verifiedDomains: number;
  customerDomains: number;
  primaryDomains: number;
  aliasDomains: number;
  vendixSubdomains: number;
  customerCustomDomains: number;
  customerSubdomains: number;
  domainsByType?: Record<string, number>;
  domainsByOwnership?: Record<string, number>;
  recentDomains?: any[];
}

export interface PaginatedDomainsResponse {
  data: DomainListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}
