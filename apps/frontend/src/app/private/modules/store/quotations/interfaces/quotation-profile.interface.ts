export interface QuotationProfileConfig {
  admin_percent?: number;
  contingency_percent?: number;
  profit_percent?: number;
  validity_days?: number;
  payment_terms?: string;
  notes?: string;
}

export interface QuotationProfileVersion {
  id: number;
  version: number;
  config: QuotationProfileConfig;
  created_at: string;
  created_by?: number | null;
}

export interface QuotationProfile {
  id: number;
  name: string;
  state: 'active' | 'inactive' | string;
  is_default: boolean;
  current_version: number;
  cloned_from_profile_id?: number | null;
  cloned_from_version?: number | null;
  current_config: QuotationProfileConfig | null;
  version?: QuotationProfileVersion | null;
  created_at: string;
  updated_at: string;
}

export interface QuotationProfileQuery {
  page?: number;
  limit?: number;
  search?: string;
  state?: 'active' | 'inactive';
}

export interface PaginatedQuotationProfilesResponse {
  data: QuotationProfile[];
  total: number;
  page: number;
  limit: number;
}

export interface QuotationProfileVersionPage {
  data: QuotationProfileVersion[];
  total: number;
  page: number;
  limit: number;
}

export interface SaveQuotationProfileDto {
  name: string;
  config: QuotationProfileConfig;
}
