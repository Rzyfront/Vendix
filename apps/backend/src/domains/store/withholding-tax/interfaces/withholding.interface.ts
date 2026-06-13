export interface WithholdingCalculationResult {
  applies: boolean;
  withholding_amount: number;
  rate: number;
  uvt_threshold_cop: number;
  concept_code: string;
  concept_name: string;
  /** Fiscal withholding type of the concept (retefuente | reteiva | reteica). */
  withholding_type?: 'retefuente' | 'reteiva' | 'reteica';
  /** Per-concept PUC account override; null when Block C resolves the default. */
  account_code?: string | null;
}

export interface WithholdingCertificateData {
  supplier_name: string;
  supplier_nit: string;
  year: number;
  total_base: number;
  total_withheld: number;
  monthly_breakdown: Array<{
    month: number;
    concept: string;
    base: number;
    rate: number;
    amount: number;
  }>;
}
