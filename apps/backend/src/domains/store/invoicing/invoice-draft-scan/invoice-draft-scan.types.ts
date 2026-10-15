/**
 * Contrato del escáner IA de borrador de factura de venta
 * (`POST store/invoicing/scan-draft/async` → `GET ai-scan-jobs/:jobId`).
 *
 * Es un BORRADOR: nada se crea, se vincula ni se emite. El frontend precarga el
 * formulario «Nueva factura» y el usuario revisa antes de guardar.
 *
 * Contrato fijo compartido con el frontend — no cambiar formas sin coordinar.
 */

/** Aplicación IA (tabla `ai_engine_applications`) que lee los documentos. */
export const INVOICE_DRAFT_SCAN_APP_KEY = 'invoice_draft_ocr';

/** Tope de documentos por escaneo (cotización + RUT + orden de compra + anexos). */
export const MAX_INVOICE_DRAFT_SCAN_FILES = 6;

/** Tope por archivo (multer). */
export const INVOICE_DRAFT_SCAN_MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Tope de la nota libre del usuario. */
export const MAX_INVOICE_DRAFT_SCAN_NOTE_LENGTH = 1000;

/** Bajo este umbral (0-100) un campo se precarga pero se marca para revisión. */
export const INVOICE_DRAFT_LOW_CONFIDENCE_THRESHOLD = 75;

/**
 * Unidades UN/ECE rec. 20 que la pantalla ofrece (`UNIT_CODE_OPTIONS` del
 * frontend). Una unidad fuera de esta lista no se precarga.
 */
export const INVOICE_DRAFT_UNIT_CODES = [
  'NIU',
  'KGM',
  'GRM',
  'LTR',
  'MLT',
  'MTR',
  'CMT',
  'MTK',
  'MTQ',
  'HUR',
  'DAY',
  'LUN',
  'PR',
  'SET',
  'BX',
  'PK',
] as const;

export interface DraftField<T> {
  value: T | null;
  /** 0-100. */
  confidence: number;
  warning: string | null;
}

export type DraftPersonType = 'NATURAL' | 'JURIDICA';
export type DraftPaymentForm = 'cash' | 'credit';
export type DraftLineMatchStatus = 'matched' | 'partial' | 'none';

export interface InvoiceDraftScanAcquirer {
  /** Valor de `identification_type_enum` (CC, CE, NIT, TI, RC, PA, PEP, PPT, DIE, NUIP). */
  document_type: DraftField<string>;
  /** Solo dígitos (alfanumérico para pasaporte), sin DV. */
  document_number: DraftField<string>;
  /** Calculado con `computeNitDv` para NIT; null para otros tipos. */
  verification_digit: DraftField<string>;
  person_type: DraftField<DraftPersonType>;
  name: DraftField<string>;
  email: DraftField<string>;
  phone: DraftField<string>;
  address_line: DraftField<string>;
  city_name: DraftField<string>;
  department_name: DraftField<string>;
  /** Código DANE de 5 dígitos, solo si se conoce con confianza. */
  municipality_code: DraftField<string>;
  /** Valor de `tax_regime_enum` o null. */
  tax_regime: DraftField<string>;
  /** Códigos RUT casilla 53 (`O-13`, `R-99-PN`, ...). */
  fiscal_responsibilities: DraftField<string[]>;
  /** Cliente existente en la organización con ese documento (solo lectura). En plataforma: null. */
  existing_customer_id: number | null;
  /**
   * Solo contexto `platform`: adquiriente ya conocido por la plataforma con ese
   * documento (tenant o cliente externo). `id` usa el formato del picker de
   * `customers/search` (`org:<n>`, `store:<n>`, `user:<n>`, `customer:<n>`).
   * En tienda siempre null.
   */
  existing_acquirer: InvoiceDraftExistingAcquirer | null;
}

/** Contexto del escaneo: borrador de tienda (default) o de la plataforma (super-admin). */
export type InvoiceDraftScanContext = 'store' | 'platform';

export interface InvoiceDraftExistingAcquirer {
  kind: 'store' | 'organization' | 'user' | 'customer';
  tenant_id: number;
  id: string;
}

export interface InvoiceDraftScanInvoice {
  /** YYYY-MM-DD */
  issue_date: DraftField<string>;
  /** YYYY-MM-DD */
  due_date: DraftField<string>;
  /** ISO 4217; por defecto la moneda de la tienda (COP en plataforma). */
  currency: DraftField<string>;
  reference: DraftField<string>;
  notes: DraftField<string>;
  /**
   * TRM declarada: pesos (COP) por UNA unidad de `currency`. Solo cuando la
   * moneda leída no es la de la tienda y el documento imprime la tasa.
   */
  exchange_rate: DraftField<number>;
  /** YYYY-MM-DD de la TRM, si el documento la imprime. */
  exchange_rate_date: DraftField<string>;
}

export interface InvoiceDraftScanPayment {
  payment_form: DraftField<DraftPaymentForm>;
  payment_term_days: DraftField<number>;
  payment_method_hint: DraftField<string>;
}

export interface InvoiceDraftScanLine {
  description: DraftField<string>;
  quantity: DraftField<number>;
  /** Antes de impuestos. */
  unit_price: DraftField<number>;
  discount_percent: DraftField<number>;
  /** Porcentaje (19, 5, 0). */
  tax_rate: DraftField<number>;
  /**
   * Unidad de medida UN/ECE rec. 20 (`NIU`, `KGM`, `HUR`…), de la lista
   * cerrada {@link INVOICE_DRAFT_UNIT_CODES}. null si no se imprimió o no se
   * reconoce (la pantalla deja su unidad por defecto).
   */
  unit_code: DraftField<string>;
  sku: string | null;
  product_id: number | null;
  product_variant_id: number | null;
  match_status: DraftLineMatchStatus;
  /** 0-100 */
  match_confidence: number;
}

/** Clase de retención que el ADQUIRIENTE practica sobre la venta. */
export type DraftWithholdingType = 'retefuente' | 'reteiva' | 'reteica';

/**
 * Retención impresa en los documentos (típicamente la orden de compra del
 * cliente agente retenedor). Desde la tienda es una retención SUFRIDA.
 */
export interface InvoiceDraftScanWithholding {
  type: DraftField<DraftWithholdingType>;
  /** PORCENTAJE (2.5 = 2,5 %; ReteICA por mil se convierte: 9.66‰ = 0.966). */
  rate: DraftField<number>;
  /** Texto del concepto tal como se imprimió («Servicios», «Compras»…). */
  concept_hint: string | null;
}

/** Reparto AIU impreso (cotizaciones y contratos de obra). */
export interface InvoiceDraftScanAiu {
  /** Porcentajes 0-100 sobre el costo directo. */
  administracion_percent: DraftField<number>;
  imprevistos_percent: DraftField<number>;
  utilidad_percent: DraftField<number>;
  /** Objeto del contrato / obra. */
  contract_object: DraftField<string>;
}

export interface InvoiceDraftScanTotals {
  subtotal: number | null;
  tax_total: number | null;
  total: number | null;
  /** null cuando no hay con qué comparar. */
  consistent: boolean | null;
}

export interface InvoiceDraftScanResult {
  acquirer: InvoiceDraftScanAcquirer;
  invoice: InvoiceDraftScanInvoice;
  payment: InvoiceDraftScanPayment;
  lines: InvoiceDraftScanLine[];
  /** Retenciones impresas (vacío si no hay). */
  withholdings: InvoiceDraftScanWithholding[];
  /** Reparto AIU impreso, o null si los documentos no traen AIU. */
  aiu: InvoiceDraftScanAiu | null;
  totals: InvoiceDraftScanTotals;
  /** Cómo se aplicó la nota del usuario, en español. */
  note_applied: string | null;
  /** Rutas con punto sin valor (p.ej. `acquirer.address_line`). */
  missing_fields: string[];
  /** Rutas con baja confianza o advertencia. */
  requires_review: string[];
  extraction_notes: string | null;
  documents_scanned: number;
}
