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
  /**
   * Fase 4: pistas de unidad de medida emitidas por el perfil
   * `invoice_ocr_ingredient`. El perfil retail (`invoice_ocr`) no las
   * emite, por eso son opcionales. `uom_hint` es un código de unidad
   * (p.ej. "L", "ml", "kg", "g", "unit") que el scanner usa para
   * preseleccionar la unidad de compra cuando `orderType==='ingredient'`.
   */
  presentation?: string | null;
  pack_size?: number | null;
  uom_hint?: string | null;
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
  /**
   * Fase 4: UoM FKs resueltas por el scanner a partir de `uom_hint`
   * (solo en flujo `ingredient`). `purchase_uom_id` se resuelve por
   * match case-insensitive de código contra el catálogo; `stock_uom_id`
   * es la unidad BASE de la misma dimensión. Sugerencia editable: el
   * usuario las confirma/ajusta en el modal de config del POP. Null
   * cuando no hay hint o no hay match en el catálogo.
   */
  purchase_uom_id?: number | null;
  stock_uom_id?: number | null;
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
