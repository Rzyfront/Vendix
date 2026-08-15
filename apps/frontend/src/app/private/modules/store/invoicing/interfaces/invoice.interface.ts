/**
 * El tipo se toma del ESPEJO DEL CONTRATO, no de una unión escrita aquí: la
 * tabla de requisitos por documento (`fiscal-document-requirements.ts`) es la
 * que decide qué campos aplican a cada tipo, y una segunda copia de la unión
 * sería el sitio donde se olvidaría un tipo nuevo. Se importa del archivo del
 * contrato y no del barril `shared/components/dian` a propósito: el barril
 * arrastra los componentes, y estos importan de vuelta este archivo.
 */
import {
  DIAN_CONFIGURATION_TYPES,
  type DianConfigurationType,
  type FiscalDocumentType,
} from '../../../../../shared/components/dian/fiscal-document-requirements';

/**
 * Estrecha el `configuration_type` que llega del backend a la unión del
 * contrato.
 *
 * Las columnas de enum viajan como `string`, y los tipos de las filas se
 * declaran así a propósito: hay consumidores que las ensanchan con su propia
 * forma (`string | null`) y un tipo estricto en la fila les rompería la
 * herencia. El estrechamiento se hace en el borde, una vez, con la misma tabla
 * que usa el backend — nunca con un `as`, que aceptaría un valor que ninguna
 * pantalla sabe pintar.
 */
export function toDianConfigurationType(
  value: string | null | undefined,
): DianConfigurationType | null {
  if (!value) return null;
  return DIAN_CONFIGURATION_TYPES.find((type) => type === value) ?? null;
}

export interface Invoice {
  id: number;
  organization_id: number;
  store_id: number;
  invoice_number: string;
  invoice_type: InvoiceType;
  status: InvoiceStatus;
  customer_id?: number;
  supplier_id?: number;
  customer_name?: string;
  customer_tax_id?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  withholding_amount: number;
  total_amount: number;
  send_status: string;
  issue_date: string;
  due_date?: string;
  notes?: string;
  order_id?: number;
  sales_order_id?: number;
  resolution_id?: number;
  created_at: string;
  updated_at: string;

  // Relations
  items?: InvoiceItem[];
  taxes?: InvoiceTax[];
  resolution?: InvoiceResolution;

  // DIAN fields
  cufe?: string;
  qr_code?: string;
  pdf_url?: string;
  sent_at?: string;
  accepted_at?: string;

  /**
   * DIAN retry-queue state attached by the backend list endpoint.
   * Only present for invoices whose send/transmission status is in an
   * error or pending-send state; `null` for the rest.
   */
  retry_status?: InvoiceRetryStatus | null;
}

export type InvoiceRetryQueueStatus =
  | 'pending'
  | 'processing'
  | 'failed'
  | 'completed';

export interface InvoiceRetryStatus {
  status: InvoiceRetryQueueStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  /** ISO timestamp of the next scheduled retry attempt. */
  next_retry_at: string | null;
}

export type InvoiceType =
  | 'sales_invoice'
  | 'purchase_invoice'
  | 'credit_note'
  | 'debit_note'
  | 'export_invoice';

export type InvoiceStatus =
  | 'draft'
  | 'validated'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'voided';

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  product_id?: number;
  product_name: string;
  description?: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  tax_rate?: number;
  // "Empaque por tarifa" snapshot — applied price tier label and the real
  // stock units consumed when packaging expands the sold quantity.
  applied_price_tier_name?: string | null;
  stock_units_consumed?: number | null;
}

export interface InvoiceTax {
  id: number;
  invoice_id: number;
  tax_name: string;
  tax_rate: number;
  tax_amount: number;
  taxable_amount: number;
}

export interface InvoiceResolution {
  id: number;
  organization_id: number;
  store_id: number;
  resolution_number: string;
  resolution_date: string;
  prefix: string;
  range_from: number;
  range_to: number;
  current_number: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
  /**
   * Qué documento numera esta fila.
   *
   * Sin este campo, una resolución de documento soporte creada desde la UI se
   * guardaba como factura de venta y secuestraba la numeración de FEV: el
   * generador de consecutivos busca la fila POR `document_type`, así que la
   * primera factura de venta emitida salía con el rango del documento soporte y
   * la DIAN la rechazaba con el consecutivo ya gastado.
   *
   * Opcional y `string` en el tipo, no en la base: la columna es NOT NULL y
   * `GET {rail}/resolutions` siempre la devuelve. Se declara así para no romper
   * a los consumidores que derivan de esta interfaz con su propia forma (la
   * consola de super admin extiende `InvoiceResolution`). Quien lo necesite
   * tipado lo estrecha en el borde con `isFiscalDocumentType`.
   */
  document_type?: string | null;
  technical_key?: string;
  created_at: string;
  updated_at: string;
}

/**
 * QUI-690 — Payload del selector de impuestos `app-tax-selector`. La forma
 * viaje hasta `CreateInvoiceItemDto.taxes[]` y al backend `CreateInvoiceDto`.
 */
export interface CreateInvoiceTaxDto {
  tax_rate_id?: number;
  tax_name: string;
  tax_rate: number;
  taxable_amount: number;
  tax_amount: number;
  /** Fiscal classification (iva/inc/ica/...). Defaults to iva when omitted. */
  tax_type?: string;
  /**
   * INCLUDED in `unit_price` (true) o ADDITIONAL on top (false). Defaults to
   * false (additional) when omitted. Drives the UBL DIAN builder's
   * `TaxInclusiveIndicator` XML attribute.
   */
  is_inclusive?: boolean;
}

/**
 * QUI-690 — Mirror frontend del `CreateCustomerDto` del backend (DIAN
 * completo). El backend acepta `inline_customer?: CreateCustomerDto` en
 * `CreateInvoiceDto`; cuando el usuario hace click en "Crear cliente" en
 * el modal XXL, este envelope viaja con la factura para que el server
 * materialice el row `users.role='customer'` y devuelva el `customer_id`.
 */
export interface CreateCustomerRequest {
  email?: string | null;
  first_name: string;
  last_name: string;
  legal_name?: string | null;
  document_number?: string | null;
  document_type?: string | null;
  verification_digit?: string | null;
  phone?: string | null;
  tax_regime?: string | null;
  person_type?: string | null;
  fiscal_responsibilities?: string[];
  ciiu_code?: string | null;
  is_withholding_agent?: boolean;
}

export interface CreateInvoiceDto {
  invoice_type: InvoiceType;
  customer_name?: string;
  customer_tax_id?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_id?: number;
  /** QUI-690 — Inline customer creation. See `CreateCustomerRequest`. */
  inline_customer?: CreateCustomerRequest;
  supplier_id?: number;
  issue_date: string;
  due_date?: string;
  notes?: string;
  resolution_id?: number;
  items: CreateInvoiceItemDto[];
  /**
   * Header-aggregated taxes (legacy). New flows use per-line `items[].taxes[]`.
   */
  taxes?: CreateInvoiceTaxDto[];
}

export interface CreateInvoiceItemDto {
  product_id?: number;
  /**
   * QUI-690 — Inline product creation payload. Backend AÚN NO lo implementa
   * (responde SYS_VALIDATION_001); el picker lo expone pero la creación
   * real se hace vía el módulo de productos.
   */
  inline_product?: any;
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  /** Legacy single tax rate (still honored for backward compat). */
  tax_rate?: number;
  /** QUI-690 — Per-line typed taxes with inclusive/additional flag. */
  taxes?: CreateInvoiceTaxDto[];
  /** QUI-690 — Per-line INCLUDED / ADDITIONAL shortcut. */
  is_inclusive?: boolean;
}

export interface UpdateInvoiceDto {
  customer_name?: string;
  customer_tax_id?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  issue_date?: string;
  due_date?: string;
  notes?: string;
  items?: CreateInvoiceItemDto[];
}

export interface CreateCreditNoteDto {
  original_invoice_id: number;
  reason: string;
  items?: CreateInvoiceItemDto[];
}

export interface CreateDebitNoteDto {
  original_invoice_id: number;
  reason: string;
  items?: CreateInvoiceItemDto[];
}

export interface CreateResolutionDto {
  resolution_number: string;
  resolution_date: string;
  prefix: string;
  range_from: number;
  range_to: number;
  valid_from: string;
  valid_to: string;
  /**
   * Qué documento numera la resolución. Ausente = `sales_invoice` (lo aplica el
   * backend). Ese defecto silencioso es exactamente el que hacía que la
   * resolución del documento soporte creada desde la UI se guardara como
   * factura de venta.
   */
  document_type?: FiscalDocumentType;
  /** Alta inactiva: se registra el rango sin ponerlo a numerar todavía. */
  is_active?: boolean;
  technical_key?: string;
}

export interface UpdateResolutionDto {
  resolution_number?: string;
  resolution_date?: string;
  prefix?: string;
  range_from?: number;
  range_to?: number;
  valid_from?: string;
  valid_to?: string;
  document_type?: FiscalDocumentType;
  /**
   * Desactivar es la ÚNICA vía para retirar del uso una resolución que ya
   * consumió numeración: el backend rechaza su borrado porque es evidencia
   * fiscal de documentos ya reportados a la DIAN.
   */
  is_active?: boolean;
  technical_key?: string;
}

export interface QueryInvoiceDto {
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  status?: string;
  invoice_type?: string;
  date_from?: string;
  date_to?: string;
}

export interface InvoiceStats {
  total_accepted_amount: number;
  total_accepted_count: number;
  total_pending_amount: number;
  total_pending_count: number;
  counts_by_status: Record<string, { count: number; amount: number }>;
}

export interface InvoiceListResponse {
  data: Invoice[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp?: string;
  path?: string;
}

// ── DIAN Configuration ────────────────────────────────────

export type DianNitType = 'NIT' | 'CC' | 'CE' | 'TI' | 'PP' | 'NIT_EXTRANJERIA';

export interface DianConfig {
  id: number;
  organization_id: number;
  store_id: number;
  name: string;
  nit: string;
  nit_type: DianNitType;
  nit_dv: string | null;
  is_default: boolean;
  /**
   * Qué habilitación DIAN cubre esta configuración.
   *
   * Cada una es una habilitación INDEPENDIENTE ante la DIAN, con su propio set
   * de pruebas y su propio estado. Sin este campo, el panel sólo sabía hablar
   * de facturación de venta y el documento soporte, el documento equivalente
   * POS y la nómina electrónica sólo se podían activar por `curl`.
   *
   * Opcional y `string` porque las respuestas antiguas no lo traen y porque hay
   * consumidores que extienden esta interfaz con su propia forma. El backend lo
   * asume `'invoicing'` cuando falta, igual que hace `DianConfigService.create`;
   * la UI lo estrecha con `toDianConfigurationType`.
   */
  configuration_type?: string | null;
  software_id: string;
  software_pin_encrypted: string; // Always '****' from API
  certificate_s3_key: string | null;
  /**
   * Sustituye a `certificate_s3_key` en la consola de tenants del super admin,
   * que redacta la clave del objeto: nombra dónde vive el material
   * criptográfico de un tercero y quien mira ahí no es el dueño del NIT.
   * Ausente en el panel del comerciante, donde la clave sí viaja.
   */
  certificate_present?: boolean;
  certificate_password_encrypted: string | null; // Always '****' from API
  certificate_expiry: string | null;
  environment: 'test' | 'production';
  /**
   * Mirrors the backend enum. `test_set_passed` is the state DIAN's approval
   * leaves behind and the only one that unlocks the production transition — it
   * was missing here, so the UI could not tell "approved" from "still testing".
   */
  enablement_status:
    | 'not_started'
    | 'testing'
    | 'test_set_passed'
    | 'enabled'
    | 'suspended'
    | 'expired';
  test_set_id: string | null;
  last_test_result: any;
  created_at: string;
  updated_at: string;
}

export interface DianTestResult {
  success: boolean;
  environment: string;
  response_time_ms: number;
  message: string;
  dian_status?: string;
  tracking_id?: string;
  /**
   * Documentos GENERADOS. Conserva ese significado por compatibilidad, así que
   * NO es lo que salió: con el envío en dos fases se generan 50 y pueden salir 30.
   * Para el reparto real, leer `generated_documents` / `transmitted_documents`.
   */
  total_documents?: number;
  /**
   * El reparto explícito, porque generado ≠ transmitido desde el envío en dos
   * fases. La UI decía «50 documentos» sobre un lote del que salieron 30 y las 20
   * notas retenidas eran invisibles: el backend las guardaba y su proyección de
   * estado las descartaba.
   */
  generated_documents?: number | null;
  transmitted_documents?: number | null;
  /** Rastro de la fase de notas. `null` cuando no hubo dos fases. */
  note_phase?: DianTestSetNotePhase | null;
  invoices_count?: number;
  debit_notes_count?: number;
  credit_notes_count?: number;
  /**
   * Tri-state verdict. `pending` means DIAN acknowledged the batch (ZipKey issued)
   * but has not judged it yet — it is NOT a failure, and re-sending would burn a
   * second block of resolution numbers. `rejected` is a real DIAN "no".
   */
  pending?: boolean;
  rejected?: boolean;
  /** DIAN's batch handle; the only way to re-poll without re-sending. */
  zip_key?: string | null;
  /**
   * Resolución con la que se envió el último set. El wizard la usa para
   * preseleccionar el selector: elegirla mal quema un bloque de consecutivos
   * autorizados que no se recupera, así que la elección del usuario debe
   * sobrevivir a recargar la página.
   */
  resolution_id?: number | null;
  error_messages?: string[];
  executed_at?: string | null;
  rechecked_at?: string | null;
  number_from?: number | null;
  number_to?: number | null;
  enablement_status?: string;
  status_message?: string;
  poll_history?: Array<{
    attempt: number;
    status_code: string;
    status_message: string;
    success: boolean;
  }>;
  /**
   * Bounded reading of the wait, computed by the backend from `pending` +
   * `executed_at`. Without it the UI can only say "pending", which after a few
   * hours reads as an infinite loop: `stalled` is the state that turns waiting
   * into a decision, and `diagnosable` says whether asking DIAN per document is
   * even possible for this batch.
   */
  wait?: DianTestSetWait;
}

/**
 * La fase de notas del set, en la VISTA que el backend expone.
 *
 * Una nota solo puede referenciar una factura que la DIAN ya tenga registrada, así
 * que el set transmite primero las facturas, sondea, y solo entonces manda las
 * notas. Si la DIAN no las registra dentro del tope de espera, las notas quedan
 * generadas, firmadas y sin transmitir — con su consecutivo ya reservado dentro
 * del XML, que es la razón por la que no se regeneran.
 *
 * El XML firmado NO viaja acá: el backend lo guarda y expone solo los recuentos.
 * El asistente sondea cada 15 s y 20 documentos firmados por sondeo es tráfico que
 * nadie lee.
 */
export interface DianTestSetNotePhase {
  /** `false` = las notas quedaron retenidas. */
  sent: boolean;
  /** Texto del backend. La UI lo muestra, no lo reescribe. */
  reason: string;
  polls: number;
  deferred_count: number;
  /** Numeración autorizada que quedó reservada y sin usar. */
  deferred_consecutives: number[];
}

export type DianTestSetWaitState =
  | 'idle'
  | 'processing'
  | 'stalled'
  | 'passed'
  | 'rejected'
  | 'abandoned';

export type DianTestSetNextAction =
  | 'run_test_set'
  | 'recheck'
  | 'diagnose_documents'
  | 'abandon_and_resend';

export interface DianTestSetWait {
  state: DianTestSetWaitState;
  waiting_ms: number | null;
  stalled: boolean;
  diagnosable: boolean;
  reason: string | null;
  next_actions: DianTestSetNextAction[];
}

/**
 * Answer of `GET /store/invoicing/uvt-threshold`: the 5 UVT ceiling for the POS
 * equivalent document (Art. 616-1 ET / Res. 000165 de 2023).
 *
 * `enforced: false` means the limit does not apply right now — electronic
 * invoicing is inactive for the store, or no UVT is configured for the year. It
 * mirrors exactly when the sale transaction also lets an anonymous sale through,
 * so the POS hint and the server gate cannot disagree.
 */
export interface PosUvtThreshold {
  enforced: boolean;
  uvt_value: number | null;
  uvt_limit: number;
  limit_cop: number | null;
  year: number;
}

/** One prerequisite in `GET dian-config/:id/production-readiness`. */
export interface DianReadinessCheck {
  key: string;
  label: string;
  satisfied: boolean;
  action: string;
  owner: 'tenant' | 'platform';
  /**
   * `warning` = early alert; it still works today and must NOT be rendered as a
   * blocker. Absent means `blocking` (the historical behavior).
   */
  severity?: 'blocking' | 'warning';
  /**
   * `dian` = our part is done and the DIAN has not ruled. Rendered as "esperando
   * a la DIAN", never as a to-do: presenting it as actionable is what makes a
   * merchant re-send a test set that is still under review. Absent means `vendix`.
   */
  blocked_by?: 'vendix' | 'dian';
  /** Days left, on the certificate-expiry alert. */
  days_remaining?: number;
  /** Share of the numbering range still available, on the range alert. */
  percent_remaining?: number;
}

export interface DianProductionReadiness {
  ready: boolean;
  dian_configuration_id: number;
  environment: string;
  enablement_status: string;
  checks: DianReadinessCheck[];
  missing: string[];
  /** Early alerts. Never affect `ready`. */
  warnings: DianReadinessCheck[];
  /** Blocking and actionable now. */
  actionable: DianReadinessCheck[];
  /** Blocking, pending a DIAN verdict. */
  waiting_on_dian: DianReadinessCheck[];
  resolutions: Array<{
    id: number;
    prefix: string;
    resolution_number: string;
    range_from: number;
    range_to: number;
    current_number: number;
    valid_from: string;
    valid_to: string;
    technical_key: string | null;
    is_habilitacion_range: boolean;
    is_expired: boolean;
    is_exhausted: boolean;
  }>;
}

export interface DianAuditLog {
  id: number;
  action: string;
  document_type: string | null;
  document_number: string | null;
  status: string;
  error_message: string | null;
  cufe: string | null;
  duration_ms: number | null;
  created_at: string;
}

/**
 * Answer of `GET /store/invoicing/dian-config/emission-status`: whether the
 * store is actually issuing electronic invoices, and if not, why.
 *
 * `is_live` mirrors the backend emission gate (`environment='production'` and
 * `enablement_status='enabled'`) — NOT `fiscal_status.invoicing.state`, which
 * only reports that the fiscal wizard was completed.
 */
export interface DianEmissionStatus {
  is_live: boolean;
  configuration_id: number | null;
  environment: string | null;
  enablement_status: string | null;
  /** Human explanation of the current stage; `null` when already live. */
  reason: string | null;
  /**
   * Unsatisfied production-readiness checks, empty when live. Mirrors the
   * backend `ProductionReadinessCheck`: `action` is what the merchant has to do,
   * and `owner` says whether they can do it at all (`platform` means only
   * Vendix operations can).
   */
  blockers: DianReadinessCheck[];
  /** Early alerts that do NOT stop emission (certificate/range about to run out). */
  warnings: DianReadinessCheck[];
  /** Blockers the merchant or Vendix can act on right now. */
  actionable: DianReadinessCheck[];
  /** Blockers waiting on a DIAN verdict. */
  waiting_on_dian: DianReadinessCheck[];
}
