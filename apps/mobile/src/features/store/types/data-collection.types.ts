export type FieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea' | 'file' | 'email' | 'phone' | 'url';
export type EntityType = 'customer' | 'booking' | 'order';
export type DisplayMode = 'summary' | 'detail';
export type TemplateStatus = 'active' | 'inactive' | 'archived';
export type SubmissionStatus = 'pending' | 'in_progress' | 'submitted' | 'processing' | 'completed' | 'expired';

export interface MetadataField {
  id: number;
  store_id: number;
  entity_type: EntityType;
  field_key: string;
  field_type: FieldType;
  label: string;
  description?: string;
  is_required: boolean;
  display_mode: DisplayMode;
  sort_order: number;
  options?: Record<string, any>;
  default_value?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DataCollectionTemplate {
  id: number;
  store_id: number;
  name: string;
  description?: string;
  icon?: string;
  status: TemplateStatus;
  entity_type: EntityType;
  is_default: boolean;
  sections?: any[];
  products?: { product: { id: number; name: string; slug: string } }[];
  created_at: string;
  updated_at: string;
}

export interface DataCollectionSubmission {
  id: number;
  store_id: number;
  template_id: number;
  booking_id?: number;
  customer_id?: number;
  token: string;
  status: SubmissionStatus;
  current_step: number;
  ai_prediagnosis?: string;
  ai_job_id?: string;
  submitted_at?: string;
  processed_at?: string;
  expires_at: string;
  template?: DataCollectionTemplate;
  booking?: {
    id: number;
    booking_number: string;
    date: string;
    start_time: string;
    product?: { id: number; name: string };
    customer?: { id: number; first_name: string; last_name: string };
  };
  customer?: { id: number; first_name: string; last_name: string };
  created_at: string;
  updated_at: string;
}
