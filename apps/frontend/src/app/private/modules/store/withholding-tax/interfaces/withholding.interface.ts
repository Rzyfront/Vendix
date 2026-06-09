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
