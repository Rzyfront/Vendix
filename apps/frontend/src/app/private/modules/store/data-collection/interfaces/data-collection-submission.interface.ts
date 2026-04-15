import { MetadataField } from './metadata-field.interface';
import { DataCollectionTemplate } from './data-collection-template.interface';

export type SubmissionStatus = 'pending' | 'in_progress' | 'submitted' | 'processing' | 'completed' | 'expired';

export interface SubmissionResponse {
  id: number;
  submission_id: number;
  field_id: number;
  value_text?: string;
  value_number?: number;
  value_date?: string;
  value_bool?: boolean;
  value_json?: any;
  field: MetadataField;
}

export interface DataCollectionSubmission {
  id: number;
  store_id: number;
  template_id: number;
  booking_id?: number;
  customer_id?: number;
  token: string;
  form_url?: string;
  status: SubmissionStatus;
  current_step: number;
  ai_prediagnosis?: string;
  ai_job_id?: string;
  submitted_at?: string;
  processed_at?: string;
  expires_at: string;
  template?: DataCollectionTemplate;
  responses?: SubmissionResponse[];
  booking?: {
    id: number;
    booking_number: string;
    date: string;
    start_time: string;
    product?: { id: number; name: string };
    provider?: { id: number; display_name: string };
    customer?: { id: number; first_name: string; last_name: string };
  };
  customer?: { id: number; first_name: string; last_name: string };
  created_at: string;
  updated_at: string;
}
