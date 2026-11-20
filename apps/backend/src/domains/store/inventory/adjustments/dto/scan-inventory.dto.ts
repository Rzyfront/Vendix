import type {
  IngestRowIssue,
  IngestSkippedRow,
} from '@common/ai-ingest/ai-ingest.types';

export interface InventoryCountItem {
  description: string;
  quantity: number;
  sku_if_visible?: string | null;
  barcode_if_visible?: string | null;
  confidence: number;
  /** ia-cargas F5a: 1-based row of the sheet this line came from (sheets only). */
  source_row?: number;
  /** Sheet name, only when the workbook has several sheets. */
  source_sheet?: string;
}
export interface InventoryCountScanResult {
  counted_items: InventoryCountItem[];
  sheet_notes?: string | null;
  confidence: number;
  extraction_notes?: string | null;
}
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
  /** ia-cargas F5a: source row of the sheet (sheets only). */
  source_row?: number;
  source_sheet?: string;
}

/** ia-cargas F5a: how the file was read. Optional: older clients ignore it. */
export interface InventoryCountScanStats {
  source: 'sheet' | 'document';
  /** Data rows found in the sheet (or lines read from the document). */
  total_rows: number;
  /** Lines that became counted products. */
  imported_rows: number;
  /** Rows left out (see `skipped`). */
  skipped_rows: number;
  /** Sheets: how the columns were recognized. */
  mapping: 'synonyms' | 'ai' | null;
  pages?: number;
  text_pages?: number;
}

export interface InventoryCountScanResponse {
  scan: InventoryCountScanResult;
  matched_products: MatchedCountProduct[];
  warnings: string[];
  /** ia-cargas F5a (sheets): rows not loaded, each with its row and reason. */
  skipped?: IngestSkippedRow[];
  /** ia-cargas F5a (sheets): notices per row (ambiguous quantity, repeated product). */
  row_issues?: IngestRowIssue[];
  /** ia-cargas F5a (sheets): column → field recognized (null = ignored). */
  columns?: Array<{ sheet?: string; column: string; field: string | null }>;
  stats?: InventoryCountScanStats;
}
