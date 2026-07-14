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

export interface ExpenseScanResponse {
  scan: ExpenseScanResult;
  matched_category: MatchedCategory | null;
}