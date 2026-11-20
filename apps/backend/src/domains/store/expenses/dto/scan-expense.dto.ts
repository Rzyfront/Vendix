/**
 * Contrato de extracción de la factura de gasto escaneada con IA.
 *
 * Estas interfaces NO usan class-validator porque los datos provienen de la
 * respuesta JSON de la IA (no del body del request HTTP). El backend los
 * normaliza defensivamente vía `normalizeExpenseOcrResponse` antes de
 * entregarlos al frontend.
 */

export interface ExpenseLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  line_index?: number;
}

export interface ExpenseScanResult {
  supplier_name: string | null;
  supplier_tax_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  currency: string;
  line_items: ExpenseLineItem[];
  subtotal: number;
  tax_amount: number | null;
  total: number;
  confidence: number;
  extraction_notes: string | null;
}

export interface MatchedCategory {
  id: number;
  name: string;
  confidence: number;
}

/**
 * How the document was read (ia-cargas F5a). Optional: older clients ignore it.
 */
export interface ExpenseScanSource {
  /** Pages (or the photo) read. */
  pages: number;
  /** Pages read from the PDF's native text. */
  text_pages: number;
  /** Model calls the document was cut into (1 = the whole document at once). */
  batches: number;
  /** Pages that could not be read. */
  missing_pages?: number[];
}

export interface ExpenseScanResponse {
  scan: ExpenseScanResult;
  matched_category: MatchedCategory | null;
  /** Spanish notices about the reading (pages left out, two totals…). Optional. */
  warnings?: string[];
  scan_source?: ExpenseScanSource;
}