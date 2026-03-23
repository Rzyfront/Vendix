export interface ExogenousReport {
  id: number;
  fiscal_year: number;
  format_code: string;
  format_name?: string;
  status: string;
  total_records: number;
  total_amount: number;
  line_count?: number;
  generated_at: string | null;
  submitted_at: string | null;
  created_at: string;
}

export interface ExogenousReportLine {
  id: number;
  third_party_nit: string;
  third_party_name: string;
  concept_code: string;
  payment_amount: number;
  tax_amount: number;
  withholding_amount: number;
}

export interface ExogenousValidationError {
  type: string;
  resource: string;
  resource_id: number;
  detail: string;
}

export interface ExogenousStats {
  total_reports: number;
  by_status: Record<string, number>;
  formats_generated: string[];
}
