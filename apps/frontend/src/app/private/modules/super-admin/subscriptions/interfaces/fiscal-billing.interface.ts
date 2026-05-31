export type SubscriptionFiscalEnvironment = 'test' | 'production';

export interface SubscriptionFiscalLastTestResult {
  ok: boolean;
  message?: string;
  dian_status?: string;
  environment: SubscriptionFiscalEnvironment;
  config_fingerprint: string;
  tested_at: string;
}

export interface SubscriptionFiscalSettings {
  is_enabled: boolean;
  auto_issue: boolean;
  environment: SubscriptionFiscalEnvironment;
  platform_organization_id: number | null;
  accounting_entity_id: number | null;
  dian_configuration_id: number | null;
  invoice_resolution_id: number | null;
  last_tested_at: string | null;
  last_test_result: SubscriptionFiscalLastTestResult | null;
  updated_by_user_id?: number | null;
  updated_at?: string | null;
}

export interface MaskedDianConfiguration {
  id: number;
  organization_id: number;
  accounting_entity_id: number;
  name: string;
  nit: string;
  nit_dv?: string | null;
  software_id: string;
  software_pin_encrypted?: '****' | null;
  environment: SubscriptionFiscalEnvironment;
  enablement_status: string;
  test_set_id?: string | null;
  certificate_s3_key?: string | null;
  certificate_password_encrypted?: '****' | null;
  certificate_expiry?: string | null;
  has_certificate: boolean;
  is_default: boolean;
  updated_at?: string | null;
}

export interface FiscalResolutionView {
  id: number;
  prefix: string;
  current_number: number;
  range_from: number;
  range_to: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
}

export interface SubscriptionFiscalStatus {
  settings: SubscriptionFiscalSettings;
  dian_config: MaskedDianConfiguration | null;
  resolution: FiscalResolutionView | null;
  stats: {
    accepted: number;
    errors: number;
    pending: number;
  };
}

export interface UpsertSubscriptionFiscalConfigDto {
  platform_organization_id: number;
  accounting_entity_id: number;
  invoice_resolution_id?: number;
  dian_configuration_id?: number;
  name: string;
  nit: string;
  nit_dv?: string;
  software_id: string;
  software_pin?: string;
  test_set_id?: string;
  environment: SubscriptionFiscalEnvironment;
  is_enabled: boolean;
  auto_issue: boolean;
  confirm_production?: boolean;
}

export interface SubscriptionFiscalTransmission {
  id: number;
  accounting_entity_id: number;
  dian_configuration_id: number | null;
  document_type: string;
  source_type: string;
  source_id: number;
  document_number: string;
  transmission_status: string;
  dian_status: string;
  accounting_status: string;
  tracking_id?: string | null;
  cufe?: string | null;
  qr_code?: string | null;
  pdf_url?: string | null;
  error_message?: string | null;
  retry_count: number;
  sent_at?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  dian_configuration?: {
    id: number;
    name: string;
    environment: SubscriptionFiscalEnvironment;
    enablement_status: string;
  } | null;
  subscription_invoice?: {
    id: number;
    invoice_number: string;
    state: string;
    total: string | number;
    currency: string;
    store_id: number;
    issued_at?: string | null;
    created_at?: string | null;
  } | null;
}

export interface SubscriptionFiscalQuery {
  page?: number;
  limit?: number;
  status?: string;
  environment?: SubscriptionFiscalEnvironment;
  search?: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface PaginatedEnvelope<T> {
  success: boolean;
  message?: string;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
