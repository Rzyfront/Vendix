/**
 * Contrato del escáner IA de «Nueva factura»
 * (`POST /store/invoicing/scan-draft/async` → `GET /ai-scan-jobs/:id`).
 *
 * El backend NO crea nada: devuelve un BORRADOR —adquiriente, cabecera, pago y
 * líneas— con la confianza de cada campo. La pantalla lo vuelca al formulario
 * y la emisión sigue siendo el botón de siempre.
 */

/** Un campo leído por la IA: valor (o `null` si no apareció), confianza 0-100 y aviso. */
export interface DraftField<T> {
  value: T | null;
  confidence: number;
  warning: string | null;
}

export type DraftPersonType = 'NATURAL' | 'JURIDICA';
export type DraftPaymentForm = 'cash' | 'credit';
export type DraftLineMatchStatus = 'matched' | 'partial' | 'none';

export interface InvoiceDraftAcquirer {
  /** `identification_type_enum` del backend: 'NIT', 'CC', 'CE', 'PASSPORT'… */
  document_type: DraftField<string>;
  document_number: DraftField<string>;
  verification_digit: DraftField<string>;
  person_type: DraftField<DraftPersonType>;
  name: DraftField<string>;
  email: DraftField<string>;
  phone: DraftField<string>;
  address_line: DraftField<string>;
  city_name: DraftField<string>;
  department_name: DraftField<string>;
  municipality_code: DraftField<string>;
  tax_regime: DraftField<string>;
  fiscal_responsibilities: DraftField<string[]>;
  /** Cliente de la tienda que el backend ya reconoció por documento. */
  existing_customer_id: number | null;
}

export interface InvoiceDraftHeader {
  /** `YYYY-MM-DD`. */
  issue_date: DraftField<string>;
  /** `YYYY-MM-DD`. */
  due_date: DraftField<string>;
  currency: DraftField<string>;
  reference: DraftField<string>;
  notes: DraftField<string>;
}

export interface InvoiceDraftPayment {
  payment_form: DraftField<DraftPaymentForm>;
  payment_term_days: DraftField<number>;
  payment_method_hint: DraftField<string>;
}

export interface InvoiceDraftLine {
  description: DraftField<string>;
  quantity: DraftField<number>;
  unit_price: DraftField<number>;
  discount_percent: DraftField<number>;
  tax_rate: DraftField<number>;
  sku: string | null;
  product_id: number | null;
  product_variant_id: number | null;
  match_status: DraftLineMatchStatus;
  match_confidence: number;
}

export interface InvoiceDraftTotals {
  subtotal: number | null;
  tax_total: number | null;
  total: number | null;
  consistent: boolean | null;
}

export interface InvoiceDraftScanResult {
  acquirer: InvoiceDraftAcquirer;
  invoice: InvoiceDraftHeader;
  payment: InvoiceDraftPayment;
  lines: InvoiceDraftLine[];
  totals: InvoiceDraftTotals;
  /** Cómo interpretó la IA la nota del usuario (p. ej. «50 % del anticipo»). */
  note_applied: string | null;
  /** Rutas con punto, p. ej. `'acquirer.address_line'`, `'lines.0.unit_price'`. */
  missing_fields: string[];
  requires_review: string[];
  extraction_notes: string | null;
  documents_scanned: number;
}

/** Topes del backend (`scan-draft`). */
export const INVOICE_DRAFT_SCAN_MAX_FILES = 6;
export const INVOICE_DRAFT_SCAN_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const INVOICE_DRAFT_SCAN_NOTE_MAX = 1000;
export const INVOICE_DRAFT_SCAN_ACCEPTED_TYPES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
