export interface DomainSettingResponse {
  id: number;
  hostname: string;
  organization_id: number;
  store_id?: number;
  config: any;
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
  domain_type?: string;
  status?: string;
  ssl_status?: string;
  is_primary?: boolean;
  ownership?: string;
  verification_token?: string | null;
}

export interface DomainResolutionResponse {
  id: number;
  hostname: string;
  organization_id: number;
  store_id?: number;
  config: any;
  created_at: string;
  updated_at: string;
  store_name?: string;
  store_slug?: string;
  organization_name?: string;
  organization_slug?: string;
  domain_type: string;
  status?: string;
  ssl_status?: string;
  is_primary?: boolean;
  ownership?: string;
}

export interface DomainListResponse {
  data: DomainSettingResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface DomainAvailabilityResponse {
  available: boolean;
  reason?: string;
}

export interface DomainValidationResponse {
  valid: boolean;
  reason?: string;
}
