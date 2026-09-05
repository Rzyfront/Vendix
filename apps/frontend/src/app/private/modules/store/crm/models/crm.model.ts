export type CrmGenerationStatus =
  | 'idle'
  | 'pending'
  | 'generating'
  | 'ready'
  | 'failed';

export interface CrmLandingState {
  enabled: boolean;
  generation_status: CrmGenerationStatus;
  content_json: unknown;
  published_json: unknown;
  published_at: string | null;
  version: number;
  last_job_id: string | null;
}

export interface CrmApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export type CrmLeadStatus = 'new' | 'contacted' | 'converted';

export interface CrmLead {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  message: string;
  status: CrmLeadStatus;
  customer_id: number | null;
  created_at: string;
}

export interface CrmLeadsData {
  leads: CrmLead[];
  stats: {
    total: number;
    new_count: number;
    contacted_count: number;
    converted_count: number;
    conversion_rate: number;
  };
}

