export interface UserConsent {
  id: number;
  user_id: number;
  consent_type: string;
  granted: boolean;
  granted_at: string | null;
  revoked_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsentUpdate {
  consent_type: string;
  granted: boolean;
}

export interface ExportRequest {
  request_id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  has_file: boolean;
  file_expires_at: string | null;
  requested_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface HabeasDataStats {
  total_consents: number;
  active_marketing: number;
  total_exports: number;
  total_anonymizations: number;
}

export interface SearchUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  document_number: string;
  document_type: string;
}
