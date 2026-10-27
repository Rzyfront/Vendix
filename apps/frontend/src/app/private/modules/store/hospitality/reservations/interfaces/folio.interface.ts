/** H3.4 — one line of the guest folio: a posted night or a manual charge. */
export interface FolioLine {
  id: number;
  kind: 'night' | 'charge';
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
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string | null;
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
