/**
 * DTOs / typed contracts for the purchase-receipt AI scanner
 * (`POST /store/dispatch-notes/receipt-scan`).
 *
 * The endpoint is multipart-only (`file` field) — there is NO request body, so
 * there is no class-validator DTO for the request. What follows are the strictly
 * typed RESPONSE shapes returned to the frontend (R4c contract), plus the small
 * internal interfaces used to normalize the raw AI JSON before matching.
 *
 * 1:1 mechanism calque of `InvoiceScannerService` / `MemberBulkScannerService`:
 * the file is preprocessed, sent through `AIEngineService.run('invoice_ocr')`,
 * the JSON is parsed defensively, and every extracted item/supplier is matched
 * against the store catalog (tenant-scoped) — ids are NEVER invented.
 */

/**
 * Per-item match confidence surfaced to the UI:
 *  - `high` — SKU exact match, or an unambiguous single name match.
 *  - `low`  — ambiguous name match (multiple candidates); `matched_product_id`
 *    stays null so the user disambiguates manually.
 *  - `none` — no catalog match at all.
 */
export type ReceiptItemMatchConfidence = 'high' | 'low' | 'none';

/**
 * A single suggested line item. `matched_product_id` / `matched_variant_id` are
 * populated ONLY on an inequívoco match (see `match_confidence`). On any doubt
 * they stay null — the frontend picker resolves the ambiguity.
 */
export interface ScannedReceiptItem {
  product_name: string;
  sku: string | null;
  quantity: number;
  unit_price: number | null;
  matched_product_id: number | null;
  matched_variant_id: number | null;
  match_confidence: ReceiptItemMatchConfidence;
}

/**
 * Top-level response of the receipt scan. `supplier_id` is populated only when
 * the extracted supplier matches an existing store supplier (by tax_id/NIT or
 * name); otherwise it is null and `supplier_name` carries the OCR value so the
 * user can create/select the supplier.
 */
export interface ScanReceiptResult {
  supplier_name: string | null;
  supplier_id: number | null;
  currency: string | null;
  items: ScannedReceiptItem[];
  warnings?: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// Internal — normalized shape of the raw AI JSON (before catalog matching).
// Not exported from the barrel; kept typed so the service does not sprinkle
// `any` through the normalization step.
// ───────────────────────────────────────────────────────────────────────────

export interface RawReceiptSupplier {
  name: string | null;
  tax_id: string | null;
}

export interface RawReceiptItem {
  description: string | null;
  sku: string | null;
  quantity: number | null;
  unit_price: number | null;
}

export interface RawReceiptScan {
  supplier: RawReceiptSupplier;
  currency: string | null;
  items: RawReceiptItem[];
}
