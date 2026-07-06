import {
  IsOptional,
  IsNumber,
  IsString,
  IsBoolean,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// --- Interfaces for OCR response (no validation needed, these come from AI) ---

export interface ExtractedSupplier {
  name: string;
  tax_id?: string;
  address?: string;
  phone?: string;
}

export interface ExtractedLineItem {
  description: string;
  quantity: number;
  /**
   * F3 IVA lifecycle: after `normalizeOcrResponse`, `unit_price` is ALWAYS
   * the NET (pre-IVA) unit price. When the invoice was inclusive
   * (`prices_include_tax === true`) the scanner-emitted gross was flattened
   * to net using the canonical formula (net = gross / (1 + tax_rate)); the
   * original printed gross is preserved in `unit_price_gross`. When the
   * invoice was exclusive, net === gross so both fields carry the same value.
   */
  unit_price: number;
  total: number;
  sku_if_visible?: string;
  /**
   * F3 IVA lifecycle: per-line IVA/consumption rate emitted by the scanner
   * as a DECIMAL FRACTION (0, 0.05, 0.19), NOT a percentage. Optional because
   * legacy scans / pre-F3 prompts do not emit it. Used to (a) flatten to net
   * and (b) suggest a tax_category by rate match in `matchProducts`.
   */
  tax_rate?: number | null;
  /**
   * F3 IVA lifecycle: the ORIGINAL printed unit price as extracted from the
   * invoice (gross when the invoice was inclusive, net when exclusive).
   * `unit_price` above is normalized to net; this keeps the raw value so the
   * UI can show "bruto → neto". Optional for pre-F3 scans.
   */
  unit_price_gross?: number | null;
  /**
   * Fase 4: presentation / pack_size / uom_hint come from the
   * `invoice_ocr_ingredient` profile. Optional because the retail
   * profile (`invoice_ocr`) does not emit them. The POP modal
   * (Phase 3) pre-fills the UoM selectors with these hints but the
   * user always confirms manually.
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
  /**
   * F3 IVA lifecycle: invoice-GLOBAL flag emitted by the scanner — do the
   * printed unit prices / line totals already INCLUDE IVA? Drives the
   * net-flattening in `normalizeOcrResponse`. Optional/defaults to `false`
   * (tax added on top) for pre-F3 scans, mirroring the canonical
   * `effective_include = ... ?? false` contract.
   */
  prices_include_tax?: boolean;
  line_items: ExtractedLineItem[];
  subtotal: number;
  tax_amount: number;
  total: number;
  confidence: number;
}

// --- Interfaces for match response ---

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
   * F3 IVA lifecycle: tax_category resolved by matching the line's
   * `tax_rate` (fraction) against the commerce's tax_categories' tax_rates.
   * `null` when there is no rate match OR when the commerce is NOT VAT
   * responsible (O-49): a non-responsible tenant capitalizes IVA into cost
   * and must not carry a deductible tax category. The user can still assign
   * one manually in the POP modal.
   */
  suggested_tax_category_id?: number | null;
  /**
   * F3 IVA lifecycle: the NET (pre-IVA) unit cost for this line — equal to
   * the normalized `unit_price`. Surfaced explicitly so the POP modal can
   * pre-fill the cost field with the net value without re-deriving it.
   */
  unit_cost_net?: number | null;
}

export interface InvoiceMatchResult {
  supplier_match: SupplierMatch;
  items: MatchedLineItem[];
  warnings: string[];
}

// --- DTOs for confirmation (validated, these come from the user) ---

export class ConfirmScannedInvoiceItemDto {
  @IsOptional()
  @IsNumber()
  product_id?: number;

  @IsOptional()
  @IsString()
  product_name?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unit_cost: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ConfirmScannedInvoiceDto {
  @IsOptional()
  @IsNumber()
  supplier_id?: number;

  @IsNumber()
  location_id: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmScannedInvoiceItemDto)
  items: ConfirmScannedInvoiceItemDto[];

  @IsOptional()
  @IsString()
  invoice_number?: string;

  @IsOptional()
  @IsString()
  invoice_date?: string;

  @IsOptional()
  @IsNumber()
  tax_amount?: number;

  @IsOptional()
  @IsNumber()
  discount_amount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  save_attachment?: boolean;
}
