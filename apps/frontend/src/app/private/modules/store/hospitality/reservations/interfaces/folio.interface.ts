/** H3.4 — one line of the guest folio: a posted night or a manual charge. */
export interface FolioLine {
  id: number;
  kind: 'night' | 'charge';
  /** H3.6 — where a POS/table room charge came from ("Restaurante · Mesa 4"). */
  origin?: string | null;
  /** Night date `YYYY-MM-DD` of a night line; null for charges. */
  night_date: string | null;
  description: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  /** Base before tax. */
  subtotal: number;
  tax_amount: number;
  total: number;
  /** Voided lines stay listed, struck through with their reason. */
  /** H3.9 — night invoiced with VAT 0 % "Exento – art. 481 lit. d ET". */
  vat_exempt?: boolean;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string | null;
}

/** H3.9 — "No residente – exento de IVA" of the holder. */
export interface FolioVatExemption {
  applied: boolean;
  /** False when a reason blocks it (no RNT, no passport, no entry permit…). */
  available: boolean;
  reasons: string[];
  applied_at: string | null;
}

/** H3.9 — one invoice of the "Servicios exentos" report. */
export interface VatExemptServiceRow {
  invoice_id: number;
  invoice_number: string | null;
  issue_date: string;
  status: string;
  reservation_id: number | null;
  reservation_number: string | null;
  guest_name: string | null;
  document_type: string | null;
  document_number: string | null;
  nationality_country_code: string | null;
  entry_permit_type: string | null;
  exempt_base: number;
  invoice_total: number;
}

export interface VatExemptServicesReport {
  from: string;
  to: string;
  rows: VatExemptServiceRow[];
}

export interface FolioPayment {
  id: number;
  amount: number;
  method: string;
  paid_at: string | null;
  /** H3.5 — 'deposit' = advance applied from the reservation deposit (D3). */
  kind?: 'payment' | 'deposit';
}

/** H3.4 — guest folio during the stay: charges, payments and balance. */
export interface FolioDetail {
  id: number;
  status: 'open' | 'closed';
  /** H3.6 — "Cargos bloqueados": POS and tables cannot charge this room. */
  charges_blocked?: boolean;
  reservation_id: number;
  order_id: number;
  order_number: string;
  lines: FolioLine[];
  payments: FolioPayment[];
  subtotal: number;
  tax_amount: number;
  total: number;
  paid: number;
  balance: number;
  /** Nights up to today the folio does not have yet ("Cargar noche"). */
  pending_nights: number;
  /** H3.5 — deposit balance that can still be applied ("Aplicar anticipo"). */
  deposit_available?: number;
  /** H3.7 / D11 — last review before the invoice, and whether it still matches the total. */
  verified_at?: string | null;
  verified_current?: boolean;
  closed_at?: string | null;
  vat_exemption?: FolioVatExemption;
}

/** H3.7 — check-out: pay the balance or charge it to the company's credit. */
export interface CheckOutRequest {
  store_payment_method_id?: number;
  charge_to_credit?: boolean;
  /** "Facturar a empresa (NIT)". */
  bill_to_customer_id?: number;
  /** The user (with "Verificar el folio") reviews it in this same step. */
  verify?: boolean;
  request_id: string;
}

/** Electronic invoice of the folio, as the POS fiscal emission reports it. */
export interface FolioInvoiceStatus {
  state: 'not_applicable' | 'pending' | 'issued' | 'contingency' | 'failed';
  message: string;
  invoice_id: number | null;
  invoice_number: string | null;
  invoice_status: string | null;
}

/** H3.8 — one invoiced account of a split folio, as the check-out reports it. */
export interface SplitAccountInvoice {
  account_id: number;
  label: string;
  grand_total: string;
  invoice: FolioInvoiceStatus | null;
  invoice_id: number | null;
  invoice_number: string | null;
  status: string | null;
}

export interface CheckOutResult {
  folio: FolioDetail;
  invoice: FolioInvoiceStatus | null;
  /** H3.8 — present only when the folio was split: one invoice per account. */
  invoices?: SplitAccountInvoice[];
}

export interface FolioChargeRequest {
  product_id: number;
  quantity: number;
  /** Unit price when it differs from the catalog. */
  unit_price?: number;
}

export interface FolioPaymentRequest {
  amount: number;
  store_payment_method_id: number;
  /** One key per payment attempt: a double click registers it once. */
  request_id: string;
}

/** H3.6 — an in-house room the POS and the tables can charge. */
export interface InHouseRoom {
  reservation_room_id: number;
  reservation_id: number;
  reservation_number: string;
  room_code: string;
  unit_type_name: string;
  guest_name: string;
  departure_date: string;
  charges_blocked: boolean;
}

/** H3.6 — POS draft sale (`order_id`) or table bill (`table_session_id`). */
export interface RoomChargeRequest {
  reservation_room_id: number;
  order_id?: number;
  table_session_id?: number;
}

export interface RoomChargeResult {
  id: number;
  reservation_id: number;
  reservation_room_id: number;
  room_code: string;
  guest_name: string;
  origin: string;
  amount: number;
  /** "Cargado a 101 · Juan Pérez". */
  message: string;
}

/** H3.8 — folio split: one account per payer, each with its own payment and invoice. */
export type SplitPaymentState = 'unpaid' | 'pending' | 'partial' | 'paid';

export interface SplitAccountInput {
  label?: string;
  customer_id?: number;
  order_item_ids: number[];
}

export interface SplitAccount {
  id: number;
  ordinal: number;
  label: string;
  customer_id: number | null;
  customer_name: string | null;
  /** Money fields are decimal strings ("595000.00"). */
  grand_total: string;
  total_paid: string;
  remaining_balance: string;
  payment_state: SplitPaymentState;
  invoice: { id: number; invoice_number: string | null; status: string } | null;
  lines: Array<{ order_item_id: number; product_name: string; total: string }>;
}

export interface SplitResult {
  source_order_id: number;
  /** Null on a preview. */
  split_group_id: number | null;
  source_version: string;
  original_total: string;
  accounts: SplitAccount[];
  undo: { allowed: boolean; blockers: Array<{ account_label: string; reason: string }> };
}

export interface SplitConfirmRequest {
  accounts: SplitAccountInput[];
  source_version: string;
  request_id: string;
}

export interface SplitPaymentRequest {
  store_payment_method_id: number;
  amount: number;
  amount_received?: number;
  request_id: string;
}
