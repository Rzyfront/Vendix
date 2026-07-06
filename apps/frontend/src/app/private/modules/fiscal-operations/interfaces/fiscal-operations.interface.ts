export type FiscalApiScope = 'store' | 'organization' | 'platform';

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface PaginatedApiResponse<T> extends ApiResponse<T[]> {
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface FiscalOverview {
  stats: {
    upcoming: number;
    overdue: number;
    declarations_ready: number;
    blocked: number;
    rejected_documents: number;
    open_close_sessions: number;
    estimated_amount: number;
    final_amount: number;
  };
  next_obligations: FiscalObligation[];
}

export interface FiscalObligation {
  id: number;
  type: string;
  status: string;
  period_year: number;
  period_month?: number | null;
  period_quarter?: number | null;
  period_start: string;
  period_end: string;
  due_date: string;
  estimated_amount?: number | string | null;
  final_amount?: number | string | null;
  currency: string;
  blocking_reason?: string | null;
  notes?: string | null;
  accounting_entity?: {
    id: number;
    legal_name?: string | null;
    business_name?: string | null;
    tax_id?: string | null;
  } | null;
  store?: {
    id: number;
    name: string;
  } | null;
}

export interface TaxDeclarationDraft {
  id: number;
  declaration_type: string;
  status: string;
  period_year: number;
  period_month?: number | null;
  period_quarter?: number | null;
  period_start: string;
  period_end: string;
  total_payable?: number | string | null;
  balance_due?: number | string | null;
  balance_favor?: number | string | null;
  validation_summary?: Record<string, unknown> | null;
  accounting_entity?: {
    id: number;
    legal_name?: string | null;
    business_name?: string | null;
    tax_id?: string | null;
  } | null;
  obligation?: FiscalObligation | null;
}

export interface TaxDeclarationLine {
  id: number;
  line_type: string;
  source_type: string;
  description: string;
  base_amount?: number | string | null;
  tax_amount?: number | string | null;
  withholding_amount?: number | string | null;
}

export interface FiscalCloseCheck {
  id: number;
  check_key: string;
  status: string;
  severity: string;
  title: string;
  description?: string | null;
  result_summary?: string | null;
  blocking: boolean;
  override_reason?: string | null;
}

export interface FiscalCloseSession {
  id: number;
  status: string;
  close_type: string;
  period_year: number;
  period_month?: number | null;
  period_start: string;
  period_end: string;
  summary?: Record<string, unknown> | null;
  checks?: FiscalCloseCheck[];
  accounting_entity?: {
    id: number;
    legal_name?: string | null;
    business_name?: string | null;
    tax_id?: string | null;
  } | null;
}

export interface FiscalEvidence {
  id: number;
  evidence_type: string;
  storage_key?: string | null;
  content_hash?: string | null;
  source_type?: string | null;
  source_id?: number | null;
  created_at: string;
}

export interface FiscalOperationEvent {
  id: number;
  event_type: string;
  resource_type: string;
  resource_id?: number | null;
  obligation_id?: number | null;
  declaration_id?: number | null;
  close_session_id?: number | null;
  evidence_id?: number | null;
  previous_status?: string | null;
  new_status?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  actor_user?: {
    id: number;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null;
  accounting_entity?: {
    id: number;
    legal_name?: string | null;
    name?: string | null;
    tax_id?: string | null;
  } | null;
  store?: {
    id: number;
    name: string;
  } | null;
}

export interface FiscalRuleSet {
  id?: number;
  country_code: string;
  year: number;
  rule_type: string;
  status: string;
  name: string;
  version: string;
  effective_from: string;
  effective_to?: string | null;
  rules: Record<string, unknown>;
  source?: string;
}

// ---------------------------------------------------------------------------
// Centro Fiscal — flow-state + config-checklist (GET /:scope/fiscal/flow-state
// y GET /:scope/fiscal/config-checklist). Append-only.
// ---------------------------------------------------------------------------

export type FiscalFlowStageStatus =
  | 'ok'
  | 'warning'
  | 'blocked'
  | 'empty'
  | 'not_applicable';

export interface FiscalFlowStage {
  key: string;
  label: string;
  status: FiscalFlowStageStatus;
  counts: Record<string, number>;
  detail?: string;
}

export interface FiscalCloseChecksSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
}

export interface FiscalFlowState {
  period: {
    year: number;
    month: number;
    start_date: string;
    end_date: string;
  };
  flows: {
    sales: { stages: FiscalFlowStage[] };
    purchases: { stages: FiscalFlowStage[] };
    payroll: { stages: FiscalFlowStage[] };
  };
  convergence: {
    journal: FiscalFlowStage;
    declarations: FiscalFlowStage;
    obligations: FiscalFlowStage;
    close: FiscalFlowStage & { checks_summary?: FiscalCloseChecksSummary };
  };
}

export interface FiscalConfigChecklistItem {
  key: string;
  label: string;
  complete: boolean;
  detail: string;
  /** Semantic navigation key — the frontend maps it to a concrete route. */
  link_hint: string;
}

export interface FiscalConfigChecklist {
  completion_pct: number;
  items: FiscalConfigChecklistItem[];
}

// ─── Identidad fiscal (tab "Identidad") ─────────────────────────────────────
// Tipos para el editor post-wizard de identidad fiscal: sección
// `settings.fiscal_data` (GET/PATCH {scope}/settings/fiscal-data) y catálogo
// versionado de responsabilidades DIAN (casilla 53 del RUT).

/** Periodicidad de declaración de IVA (art. 600 ET). */
export type FiscalVatPeriodicity = 'monthly' | 'bimonthly' | 'four_monthly';

/**
 * Sección `fiscal_data` persistida en store_settings/organization_settings.
 * Index signature: el backend hace PATCH-merge y puede devolver llaves
 * adicionales que la UI debe preservar sin conocerlas.
 */
export interface FiscalDataSettings {
  nit?: string;
  nit_dv?: string;
  nit_type?: string;
  legal_name?: string;
  person_type?: 'NATURAL' | 'JURIDICA';
  tax_regime?: 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE';
  ciiu?: string;
  fiscal_address?: string;
  country?: string;
  department?: string;
  city?: string;
  tax_responsibilities?: string[];
  tax_scheme?: string;
  is_withholding_agent?: boolean;
  is_self_withholder?: boolean;
  vat_periodicity?: FiscalVatPeriodicity;
  /** Código DANE (Divipola) del municipio — columna real `stores.municipality_code`. */
  municipality_code?: string;
  /** Código CIIU dedicado — columna real `stores.ciiu_code` / `organizations.ciiu_code`. */
  ciiu_code?: string;
  [key: string]: unknown;
}

export interface FiscalDataResponse {
  fiscal_data: FiscalDataSettings | null;
}

/**
 * GET/PATCH fiscal-data difieren por scope: el controller de store envuelve
 * con ResponseService (`{ success, data: { fiscal_data } }`) y el de
 * organization devuelve `{ fiscal_data }` plano. La UI normaliza ambos.
 */
export type FiscalDataEnvelope =
  | ApiResponse<FiscalDataResponse>
  | FiscalDataResponse;

/** Entrada del catálogo DIAN de responsabilidades (casilla 53 del RUT). */
export interface FiscalResponsibilityCatalogEntry {
  code: string;
  label: string;
  description: string;
  effects: string[];
  obligation_types?: string[];
}

export interface FiscalResponsibilitiesCatalog {
  version: number;
  responsibilities: FiscalResponsibilityCatalogEntry[];
}

// ---------------------------------------------------------------------------
// Reglas fiscales — CRUD organización (tab "Reglas"). Append-only.
// Las mutaciones existen SOLO en /organization/fiscal/rules (el scope store
// es de lectura). `FiscalRuleSet` queda intacto; el detalle agrega los campos
// de tenant que devuelve el backend en las filas reales (los defaults Vendix
// del list() no traen `id` ni `organization_id`).
// ---------------------------------------------------------------------------

/** Fila de regla fiscal con metadatos de tenant (filas reales de BD). */
export interface FiscalRuleSetDetail extends FiscalRuleSet {
  organization_id?: number | null;
  accounting_entity_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

/** Payload de creación — espejo de CreateFiscalRuleSetDto del backend. */
export interface CreateFiscalRuleSetPayload {
  name: string;
  rule_type: string;
  year: number;
  country_code?: string;
  version?: string;
  effective_from?: string;
  rules: Record<string, unknown>;
  accounting_entity_id?: number;
}

/** Payload de edición (solo drafts) — espejo de UpdateFiscalRuleSetDto. */
export interface UpdateFiscalRuleSetPayload {
  name?: string;
  rule_type?: string;
  year?: number;
  version?: string;
  effective_from?: string;
  rules?: Record<string, unknown>;
}
