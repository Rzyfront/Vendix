export interface MetaReadiness {
  status: 'missing_env' | 'pending_approval' | 'approved' | 'rejected';
  configured: boolean;
  missing_envs: string[];
  app_review_status: string;
  allow_dev_signup: boolean;
  can_start_signup: boolean;
  source: 'platform_settings' | 'environment';
  platform_settings_key: string;
  app_id: string | null;
  whatsapp_config_id: string | null;
  graph_version: string | null;
  required_permissions: string[];
  production_checklist: string[];
}

export interface WhatsappChannel {
  id?: number;
  connected: boolean;
  status: string;
  provider: string;
  channel_type: string;
  waba_id?: string | null;
  phone_number_id?: string | null;
  display_phone_number?: string | null;
  business_account_id?: string | null;
  token_expires_at?: string | null;
  connected_at?: string | null;
  disconnected_at?: string | null;
  last_error?: string | null;
  metadata?: Record<string, any> | null;
}

export interface CompleteWhatsappEmbeddedSignupRequest {
  code: string;
  waba_id: string;
  phone_number_id: string;
  display_phone_number?: string;
  business_account_id?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}
