export interface WithholdingConcept {
  id: number;
  code: string;
  name: string;
  rate: number;
  min_uvt_threshold: number;
  applies_to: string;
  supplier_type_filter: string;
  withholding_type?: 'retefuente' | 'reteiva' | 'reteica';
  account_code?: string;
  is_active: boolean;
  created_at: string;
}

export interface UvtValue {
  id: number;
  year: number;
  value_cop: number;
}

export interface WithholdingStats {
  active_concepts: number;
  current_uvt: number;
  month_withholdings: number;
  year_withholdings: number;
}

export interface CreateConceptDto {
  code: string;
  name: string;
  rate: number;
  min_uvt_threshold?: number;
  applies_to: string;
  supplier_type_filter?: 'any' | 'gran_contribuyente' | 'regimen_simple' | 'persona_natural';
  withholding_type?: 'retefuente' | 'reteiva' | 'reteica';
  account_code?: string;
}

export type UpdateConceptDto = Partial<CreateConceptDto>;

/**
 * Legal role of the operation feeding the withholding preview:
 *  - 'practiced' → tenant buys (POP) and may withhold a supplier.
 *  - 'suffered'  → tenant sells (POS) and a customer may withhold the tenant.
 */
export type WithholdingRole = 'practiced' | 'suffered';

export type WithholdingType = 'retefuente' | 'reteiva' | 'reteica';

/**
 * One resolved withholding line returned by the backend preview endpoint.
 * The backend is the single source of truth; the client never computes these.
 */
export interface WithholdingLine {
  withholding_type: WithholdingType;
  concept_code: string;
  rate: number;
  base: number;
  amount: number;
  role: WithholdingRole;
  account_role?: string;
  [key: string]: unknown;
}

/**
 * Request body for `POST /store/withholding-tax/preview`.
 * Tenant context (organization_id / store_id) is derived server-side from the
 * JWT — never sent from the client.
 */
export interface PreviewWithholdingRequest {
  role: WithholdingRole;
  base: number;
  supplier_id?: number;
  customer_id?: number;
  ivaAmount?: number;
  year?: number;
}

/** `data` payload of the preview response (unwrapped from ResponseService). */
export interface WithholdingPreviewResult {
  lines: WithholdingLine[];
  total_withholding: number;
}

// ── Calculations audit (`GET /store/withholding-tax/calculations`) ──

/** One persisted withholding calculation row from the audit endpoint. */
export interface WithholdingCalculation {
  id: number;
  invoice_id?: number | null;
  supplier_id?: number | null;
  customer_id?: number | null;
  concept_id: number;
  role: WithholdingRole;
  withholding_type?: WithholdingType | null;
  /** Prisma Decimal serialized as string — convert with Number() for math. */
  base_amount: string | number;
  withholding_rate: string | number;
  withholding_amount: string | number;
  uvt_value_used?: string | number;
  year: number;
  created_at?: string | null;
  concept?: { name: string; code: string } | null;
  supplier?: { id: number; name: string; tax_id?: string | null } | null;
  customer?: {
    id: number;
    first_name: string;
    last_name: string;
    email?: string;
  } | null;
  invoice?: { id: number; invoice_number: string } | null;
}

/** Query params for the calculations audit list. */
export interface WithholdingCalculationsQuery {
  page?: number;
  limit?: number;
  year?: number;
  month?: number;
  supplier_id?: number;
  concept_id?: number;
  role?: WithholdingRole;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedApiResponse<T> {
  success: boolean;
  message: string;
  data: T[];
  meta: PaginationMeta;
}

// ── Certificates (`GET /store/withholding-tax/certificates/:id`) ──

export interface WithholdingCertificateRow {
  month: number;
  concept: string;
  base: number;
  rate: number;
  amount: number;
}

/** Shape returned by the backend certificate generator (retención practicada a proveedor). */
export interface WithholdingCertificateData {
  supplier_name: string;
  supplier_nit: string;
  year: number;
  total_base: number;
  total_withheld: number;
  monthly_breakdown: WithholdingCertificateRow[];
}

// ── Suffered withholding certificate (`GET .../certificates/suffered/:type/:id`) ──

export interface SufferedWithholdingCertificateRow {
  month: number;
  concept: string;
  withholding_type: WithholdingType;
  base: number;
  rate: number;
  amount: number;
}

/** Certificado de retención "sufrida": un customer/supplier retuvo al tenant. */
export interface SufferedWithholdingCertificateData {
  counterparty_type: 'customer' | 'supplier';
  counterparty_name: string;
  counterparty_nit: string;
  year: number;
  total_base: number;
  total_withheld: number;
  monthly_breakdown: SufferedWithholdingCertificateRow[];
}

// ── Employee income certificate / Form 220 (`GET .../certificates/employee/:id`) ──

export interface EmployeeIncomeCertificateRow {
  month: number;
  salary: number;
  health_deduction: number;
  pension_deduction: number;
  withholding: number;
}

/** Certificado de Ingresos y Retenciones (Formulario 220 DIAN) por empleado y año. */
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
  monthly_breakdown: EmployeeIncomeCertificateRow[];
}
