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
}

export interface InventoryCountScanResponse {
  scan: InventoryCountScanResult;
  matched_products: MatchedCountProduct[];
  warnings: string[];
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
