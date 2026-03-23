export interface ExogenousValidationError {
  type: 'missing_nit' | 'missing_name' | 'incomplete_data';
  resource: string;
  resource_id: number;
  detail: string;
}

export interface ExogenousStats {
  total_reports: number;
  by_status: Record<string, number>;
  formats_generated: string[];
}

export interface ExogenousLineData {
  third_party_nit: string;
  third_party_name: string;
  third_party_dv?: string;
  concept_code: string;
  payment_amount: number;
  tax_amount: number;
  withholding_amount: number;
  line_data?: Record<string, any>;
}
