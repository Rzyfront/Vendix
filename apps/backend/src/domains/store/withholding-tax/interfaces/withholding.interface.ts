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

/**
 * Certificado de retención "sufrida" (art. 381/task role=suffered): el
 * tercero (customer o supplier) actuó como agente retenedor y practicó una
 * retención al tenant en una venta. Mismo shape de desglose mensual que
 * {@link WithholdingCertificateData}, pero la contraparte es quien retiene
 * (no quien recibe la retención) — de ahí el campo `counterparty_type`.
 */
export interface SufferedWithholdingCertificateData {
  counterparty_type: 'customer' | 'supplier';
  counterparty_name: string;
  counterparty_nit: string;
  year: number;
  total_base: number;
  total_withheld: number;
  monthly_breakdown: Array<{
    month: number;
    concept: string;
    withholding_type: string;
    base: number;
    rate: number;
    amount: number;
  }>;
}

/**
 * Certificado de Ingresos y Retenciones (Formulario 220 DIAN) por empleado y
 * año gravable. Salarios/aportes vienen de `payroll_items` (JSON `earnings`/
 * `deductions` ya persistidos — nunca se recalcula nómina histórica);
 * la retefuente laboral total viene de `deductions.retention` (misma fuente
 * que el asiento 236505, B1).
 */
export interface EmployeeIncomeCertificateData {
  employee_name: string;
  employee_document_type: string;
  employee_document_number: string;
  employer_name: string;
  employer_nit: string;
  year: number;
  total_salaries: number;
  total_health_deduction: number;
  total_pension_deduction: number;
  total_withholding: number;
  monthly_breakdown: Array<{
    month: number;
    salary: number;
    health_deduction: number;
    pension_deduction: number;
    withholding: number;
  }>;
}
