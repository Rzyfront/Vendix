/**
 * Inventory Recount Scanner Interfaces
 * Mirror of backend DTOs for AI-assisted inventory count scanning
 * (POST /store/inventory/adjustments/scan)
 */

// ============================================================================
// Scan Result (from OCR)
// ============================================================================

export interface InventoryCountItem {
  description: string;
  quantity: number;
  sku_if_visible?: string | null;
  barcode_if_visible?: string | null;
  confidence: number;
}

export interface InventoryCountScanResult {
  counted_items: InventoryCountItem[];
  sheet_notes?: string | null;
  confidence: number;
  extraction_notes?: string | null;
}

// ============================================================================
// Match Result (product matching)
// ============================================================================

export interface MatchedCountProduct {
  description: string;
  counted_quantity: number;
  sku_if_visible?: string | null;
  barcode_if_visible?: string | null;
  match_status: 'matched' | 'partial' | 'new';
  selected_product_id: number | null;
  selected_product_name: string | null;
  selected_product_variant_id: number | null;
  stock_on_hand: number | null;
  candidates: {
    id: number;
    name: string;
    sku: string | null;
    confidence: number;
    product_variant_id?: number | null;
  }[];
  /** ia-cargas F5a: row of the uploaded sheet this line came from (sheets only). */
  source_row?: number;
  source_sheet?: string;
}

/** ia-cargas F5a: a sheet row that did not become a counted line, and why. */
export interface CountSkippedRow {
  row: number;
  row_end?: number;
  sheet?: string;
  reason: 'empty' | 'total' | 'header' | 'limit' | 'unreadable' | 'duplicate';
  message: string;
}

/** ia-cargas F5a: something to check on a sheet row (the line was still read). */
export interface CountRowIssue {
  row: number;
  sheet?: string;
  level: 'warning' | 'error';
  field?: string;
  message: string;
}

export interface InventoryCountScanStats {
  source: 'sheet' | 'document';
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  mapping: 'synonyms' | 'ai' | null;
  pages?: number;
  text_pages?: number;
}

export interface InventoryCountScanResponse {
  scan: InventoryCountScanResult;
  matched_products: MatchedCountProduct[];
  warnings: string[];
  /** ia-cargas F5a (all optional): sheet rows left out, notices per row, stats. */
  skipped?: CountSkippedRow[];
  row_issues?: CountRowIssue[];
  columns?: Array<{ sheet?: string; column: string; field: string | null }>;
  stats?: InventoryCountScanStats;
}

// ============================================================================
// Confirmation DTO
// ============================================================================

export interface ConfirmRecountPayload {
  location_id: number;
  items: {
    product_id: number;
    product_variant_id?: number | null;
    type: string;
    quantity_after: number;
    description?: string;
  }[];
}
