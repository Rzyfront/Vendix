/**
 * Invoice Scanner Interfaces
 * Mirror of backend DTOs for OCR invoice scanning
 */

// ============================================================================
// Scan Result (from OCR)
// ============================================================================

export interface ExtractedSupplier {
  name: string;
  tax_id?: string;
  address?: string;
  phone?: string;
}

export interface ExtractedLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  sku_if_visible?: string;
}

export interface InvoiceScanResult {
  supplier: ExtractedSupplier;
  invoice_number: string;
  invoice_date: string;
  payment_terms?: string;
  line_items: ExtractedLineItem[];
  subtotal: number;
  tax_amount: number;
  total: number;
  confidence: number;
}

// ============================================================================
// Match Result (product matching)
// ============================================================================

export interface SupplierMatch {
  matched_id?: number;
  name: string;
  tax_id?: string;
  confidence: number;
  is_new: boolean;
}

export interface ProductCandidate {
  id: number;
  name: string;
  sku: string;
  cost_price?: number;
  confidence: number;
}

export interface MatchedLineItem extends ExtractedLineItem {
  match_status: 'matched' | 'partial' | 'new';
  selected_product_id?: number;
  candidates: ProductCandidate[];
}

export interface InvoiceMatchResult {
  supplier_match: SupplierMatch;
  items: MatchedLineItem[];
  warnings: string[];
}

// ============================================================================
// Confirmation DTOs
// ============================================================================

export interface ConfirmScannedInvoiceItemDto {
  product_id?: number;
  product_name?: string;
  sku?: string;
  quantity: number;
  unit_cost: number;
  description?: string;
}

export interface ConfirmScannedInvoiceDto {
  supplier_id?: number;
  location_id: number;
  items: ConfirmScannedInvoiceItemDto[];
  invoice_number?: string;
  invoice_date?: string;
  tax_amount?: number;
  discount_amount?: number;
  notes?: string;
  save_attachment?: boolean;
}
