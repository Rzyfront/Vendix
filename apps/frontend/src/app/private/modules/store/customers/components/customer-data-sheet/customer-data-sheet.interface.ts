import type { DataCollectionTemplate } from '../../../data-collection/interfaces/data-collection-template.interface';
import type { FieldType } from '../../../data-collection/interfaces/metadata-field.interface';

/** Effective template of a customer sheet (customer-scoped fields only). */
export type DataSheetTemplate = DataCollectionTemplate;

export interface DataSheetValue {
  field_id: number;
  field_key: string;
  label: string;
  field_type: FieldType;
  value_text: string | null;
  value_number: string | null;
  /** Date-only `YYYY-MM-DD`. */
  value_date: string | null;
  value_bool: boolean | null;
  value_json: unknown;
  /** Signed URL when `field_type` is `file`. */
  file_url: string | null;
  updated_at: string;
}

export interface DataSheetTemplateOption {
  id: number;
  name: string;
  is_crm_default: boolean;
}

export interface CustomerDataSheet {
  customer_id: number;
  selected_template_id: number | null;
  default_template_id: number | null;
  template: DataSheetTemplate | null;
  templates: DataSheetTemplateOption[];
  values: DataSheetValue[];
  other_values: DataSheetValue[];
}

/** One changed answer; an all-null entry deletes the answer. */
export interface DataSheetValueInput {
  field_id: number;
  value_text?: string | null;
  value_number?: number | null;
  value_date?: string | null;
  value_bool?: boolean | null;
  value_json?: unknown;
}

export interface DataSheetUploadResult {
  key: string;
  url: string;
  original_name: string;
}
