/**
 * Interfaces para el escaneo de facturas de gasto con IA.
 * Espejo del backend (ExpenseScannerService + DTOs).
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
  invoice_date: string | null; // YYYY-MM-DD
  currency: string; // default COP
  line_items: ExpenseLineItem[];
  subtotal: number | null;
  tax_amount: number | null;
  total: number | null;
  confidence: number; // 0-100
  extraction_notes: string | null;
}

export interface ExpenseScanResponse {
  scan: ExpenseScanResult;
  matched_category: { id: number; name: string; confidence: number } | null;
}

export interface ConfirmScannedExpensePayload {
  description: string;
  amount: number;
  currency?: string;
  category_id?: number;
  expense_date: Date | string;
  notes?: string;
  receipt_url?: string;
  items?: ExpenseLineItem[];
}