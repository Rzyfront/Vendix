// La fase de notas es la MISMA en los tres rieles: el backend la proyecta con
// `buildNotePhaseView` y la expone igual en `store/invoicing`, en el rail de tenant
// y acá. Reusar el tipo evita que una copia se desvíe.
import type { DianTestSetNotePhase } from '../../../store/invoicing/interfaces/invoice.interface';

export type SubscriptionFiscalEnvironment = 'test' | 'production';

export interface SubscriptionFiscalLastTestResult {
  ok: boolean;
  message?: string;
  dian_status?: string;
  environment: SubscriptionFiscalEnvironment;
  config_fingerprint: string;
  tested_at: string;
}

export interface SubscriptionFiscalSettings {
  is_enabled: boolean;
  auto_issue: boolean;
  environment: SubscriptionFiscalEnvironment;
  platform_organization_id: number | null;
  accounting_entity_id: number | null;
  dian_configuration_id: number | null;
  invoice_resolution_id: number | null;
  last_tested_at: string | null;
  last_test_result: SubscriptionFiscalLastTestResult | null;
  updated_by_user_id?: number | null;
  updated_at?: string | null;
}

export interface MaskedDianConfiguration {
  id: number;
  organization_id: number;
  accounting_entity_id: number;
  name: string;
  nit: string;
  nit_dv?: string | null;
  software_id: string;
  software_pin_encrypted?: '****' | null;
  environment: SubscriptionFiscalEnvironment;
  enablement_status: string;
  test_set_id?: string | null;
  certificate_s3_key?: string | null;
  certificate_password_encrypted?: '****' | null;
  certificate_expiry?: string | null;
  has_certificate: boolean;
  is_default: boolean;
  updated_at?: string | null;
}

export interface FiscalResolutionView {
  id: number;
  prefix: string;
  current_number: number;
  range_from: number;
  range_to: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
}

/**
 * Identidad fiscal de la plataforma resuelta por el backend para prellenar el
 * formulario. Los campos que emite la DIAN (`software_id`, `software_pin`,
 * `test_set_id`) no aparecen aquí a propósito: no son derivables.
 */
export interface SubscriptionFiscalSuggestion {
  platform_organization_id: number | null;
  accounting_entity_id: number | null;
  name: string | null;
  nit: string | null;
  nit_dv: string | null;
}

export type PlatformTestSetWaitState =
  | 'idle'
  | 'processing'
  | 'stalled'
  | 'passed'
  | 'rejected'
  | 'abandoned';

export type PlatformTestSetNextAction =
  | 'run_test_set'
  | 'recheck'
  | 'diagnose_documents'
  | 'abandon_and_resend';

/**
 * Bounded reading of the habilitación batch. `stalled` is what stops the page
 * from rendering an unbounded "en proceso": DIAN acknowledged the ZipKey but has
 * demonstrably stopped answering, and the next step is a decision, not a wait.
 */
export interface PlatformTestSetWait {
  state: PlatformTestSetWaitState;
  waiting_ms: number | null;
  stalled: boolean;
  /** False for legacy batches whose per-document keys were never persisted. */
  diagnosable: boolean;
  reason: string | null;
  next_actions: PlatformTestSetNextAction[];
}

/**
 * Composición del set según el modo de operación declarado, resuelta por el
 * backend. Llega del servidor a propósito: la UI la tenía escrita a mano como
 * "50 documentos" —la composición de 2019— y así desinformaba sobre cuántos
 * consecutivos de la resolución consume cada envío. Un número que el cliente no
 * puede derivar es un número que el cliente hardcodea y deja envejecer.
 */
export interface PlatformTestSetComposition {
  invoices: number;
  credit_notes: number;
  debit_notes: number;
  /** Consecutivos que consume el envío. */
  total: number;
  /** e.g. "2 facturas + 1 nota crédito + 1 nota débito". */
  label: string;
}

export interface PlatformTestSetStatus {
  enablement_status: string | null;
  test_set_id: string | null;
  environment: SubscriptionFiscalEnvironment | string | null;
  /**
   * El registro del lote SIN `note_phase`: ese campo guarda cada nota retenida con
   * su XML firmado, y el panel sondea este endpoint. El recuento va en
   * `note_phase`, abajo, ya proyectado.
   */
  last_test_result: Record<string, unknown> | null;
  /**
   * Rastro de la fase de notas. `null` cuando no hubo dos fases.
   *
   * Es el mismo tipo que consume el asistente de tiendas: el backend proyecta con
   * la misma función, así que un segundo tipo solo podría desviarse.
   */
  note_phase?: DianTestSetNotePhase | null;
  wait: PlatformTestSetWait;
  composition?: PlatformTestSetComposition | null;
}

/**
 * One prerequisite for submitting the platform habilitación set.
 * `issued_by_dian` separates "we still have to do this" from "we are waiting on
 * the DIAN to issue it" — the second kind cannot be fixed from the app.
 */
export interface PlatformHabilitationCheck {
  key: string;
  label: string;
  satisfied: boolean;
  action: string;
  /** Derived mirror of `blocked_by === 'dian'`. */
  issued_by_dian: boolean;
  /**
   * Same contract as the tenant checklist: `warning` is an early alert that must
   * NOT be rendered as a blocker nor counted against `ready`.
   */
  severity?: 'blocking' | 'warning';
  owner?: 'tenant' | 'platform';
  blocked_by?: 'vendix' | 'dian';
  days_remaining?: number;
  percent_remaining?: number;
}

export interface PlatformHabilitationReadiness {
  ready: boolean;
  checks: PlatformHabilitationCheck[];
  /** Blocking and actionable by Vendix operations right now. */
  actionable?: PlatformHabilitationCheck[];
  /** Blocking, pending a DIAN issuance or verdict. */
  waiting_on_dian?: PlatformHabilitationCheck[];
  /** Early alerts. Never affect `ready`. */
  warnings?: PlatformHabilitationCheck[];
}

export interface SubscriptionFiscalStatus {
  settings: SubscriptionFiscalSettings;
  dian_config: MaskedDianConfiguration | null;
  resolution: FiscalResolutionView | null;
  stats: {
    accepted: number;
    errors: number;
    pending: number;
  };
  suggested?: SubscriptionFiscalSuggestion | null;
  test_set?: PlatformTestSetStatus | null;
  habilitation_readiness?: PlatformHabilitationReadiness | null;
}

export interface UpsertSubscriptionFiscalConfigDto {
  /**
   * Los tres ids de identidad los DERIVA el backend y los ignora si llegan. Se
   * mantienen opcionales solo por compatibilidad con clientes viejos: la
   * plataforma es una sola persona jurídica con una sola entidad fiscal, y el
   * cliente Prisma scopeado deriva esa entidad en cada consulta — un valor
   * distinto no fallaba al guardar, fallaba después con un 404 sobre filas que
   * existían.
   */
  platform_organization_id?: number;
  accounting_entity_id?: number;
  dian_configuration_id?: number;
  invoice_resolution_id?: number;
  name: string;
  nit: string;
  nit_dv?: string;
  software_id: string;
  software_pin?: string;
  test_set_id?: string;
  // Opcional: el frontend lo omite cuando el ambiente no cambió (la edición
  // normal no debe promover). El backend ahora lo trata como opcional.
  environment?: SubscriptionFiscalEnvironment;
  is_enabled: boolean;
  auto_issue: boolean;
  confirm_production?: boolean;
}

export interface SubscriptionFiscalTransmission {
  id: number;
  accounting_entity_id: number;
  dian_configuration_id: number | null;
  document_type: string;
  source_type: string;
  source_id: number;
  document_number: string;
  transmission_status: string;
  dian_status: string;
  accounting_status: string;
  tracking_id?: string | null;
  cufe?: string | null;
  qr_code?: string | null;
  pdf_url?: string | null;
  error_message?: string | null;
  retry_count: number;
  sent_at?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  dian_configuration?: {
    id: number;
    name: string;
    environment: SubscriptionFiscalEnvironment;
    enablement_status: string;
  } | null;
  subscription_invoice?: {
    id: number;
    invoice_number: string;
    state: string;
    total: string | number;
    currency: string;
    store_id: number;
    issued_at?: string | null;
    created_at?: string | null;
  } | null;
}

export interface SubscriptionFiscalQuery {
  page?: number;
  limit?: number;
  status?: string;
  environment?: SubscriptionFiscalEnvironment;
  search?: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface PaginatedEnvelope<T> {
  success: boolean;
  message?: string;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// ─────────────────────────────────────────────────────────
// Platform DIAN Resolutions
// ─────────────────────────────────────────────────────────

export type PlatformResolutionDocumentType =
  | 'sales_invoice'
  | 'support_document';

export interface PlatformResolution {
  id: number;
  prefix: string;
  document_type: PlatformResolutionDocumentType;
  resolution_number: string | null;
  resolution_date: string | null;
  range_from: number;
  range_to: number;
  current_number: number;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  technical_key?: string | null;
  environment: SubscriptionFiscalEnvironment;
  organization_id: number;
  accounting_entity_id: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CreatePlatformResolutionDto {
  prefix: string;
  document_type: PlatformResolutionDocumentType;
  environment: SubscriptionFiscalEnvironment;
  rango_inicial: number;
  rango_final: number;
  technical_key?: string;
  resolution_number?: string;
  resolution_date?: string;
  valid_from?: string;
  valid_to?: string;
}

/**
 * Partial update. `prefix` / `document_type` / `rango_inicial` are the
 * DIAN-authorized identity of the resolution: the backend rejects changing them
 * once numbering was consumed, so the form disables them in that state.
 */
export interface UpdatePlatformResolutionDto {
  prefix?: string;
  document_type?: PlatformResolutionDocumentType;
  rango_inicial?: number;
  rango_final?: number;
  technical_key?: string;
  resolution_number?: string;
  resolution_date?: string;
  valid_from?: string;
  valid_to?: string;
  is_active?: boolean;
}

export interface ListPlatformResolutionsQuery {
  document_type?: PlatformResolutionDocumentType;
  environment?: SubscriptionFiscalEnvironment;
  is_active?: boolean;
}

// ─────────────────────────────────────────────────────────
// Vendor Support Document Fiscal (documento soporte)
// ─────────────────────────────────────────────────────────

export interface VendorSupportFiscalSettings {
  is_enabled: boolean;
  auto_transmit: boolean;
  environment: SubscriptionFiscalEnvironment;
  dian_configuration_id: number | null;
  invoice_resolution_id: number | null;
  updated_by_user_id?: number | null;
  updated_at?: string | null;
}

export interface VendorSupportFiscalConfig {
  settings: VendorSupportFiscalSettings;
  platform_organization_id: number | null;
  accounting_entity_id: number | null;
  dian_config: MaskedDianConfiguration | null;
  resolution: FiscalResolutionView | null;
  stats: {
    accepted: number;
    errors: number;
    pending: number;
  };
}

export interface PatchVendorSupportFiscalConfigDto {
  is_enabled: boolean;
  auto_transmit: boolean;
  environment: SubscriptionFiscalEnvironment;
  invoice_resolution_id?: number;
}

export interface VendorSupportFiscalTransmission {
  id: number;
  accounting_entity_id: number;
  dian_configuration_id: number | null;
  document_type: string;
  source_type: string;
  source_id: number;
  document_number: string;
  transmission_status: string;
  dian_status: string;
  accounting_status: string;
  tracking_id?: string | null;
  cuds?: string | null;
  qr_code?: string | null;
  pdf_url?: string | null;
  error_message?: string | null;
  retry_count: number;
  sent_at?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  dian_configuration?: {
    id: number;
    name: string;
    environment: SubscriptionFiscalEnvironment;
    enablement_status: string;
  } | null;
  vendor_support_document?: {
    id: number;
    invoice_number: string;
    status: string;
    total: string | number;
    currency: string;
    vendor_nit: string;
    vendor_name: string;
    issue_date: string;
    created_at?: string | null;
  } | null;
}

export interface VendorSupportFiscalQuery {
  page?: number;
  limit?: number;
  status?: string;
  environment?: SubscriptionFiscalEnvironment;
  search?: string;
}
