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
