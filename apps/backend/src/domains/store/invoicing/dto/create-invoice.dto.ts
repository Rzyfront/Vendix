import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaxFiscalType } from '../../taxes/dto';
import { CreateCustomerDto } from '../../customers/dto/create-customer.dto';
import { CreateProductDto } from '../../products/dto';

export class CreateInvoiceItemDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  product_variant_id?: number;

  /**
   * Inline product creation payload. When present AND `product_id` is omitted,
   * the backend creates a new `products` row inside the same transaction as
   * the invoice and uses the resulting `product_id`. Ignored when `product_id`
   * is provided. All `CreateProductDto` validators apply (price, type, etc.).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateProductDto)
  inline_product?: CreateProductDto;

  @IsString()
  @MaxLength(500)
  description: string;

  @IsNumber()
  @Type(() => Number)
  quantity: number;

  @IsNumber()
  @Type(() => Number)
  unit_price: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  discount_amount?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  tax_amount?: number;

  /**
   * Per-line typed taxes (DIAN). Drives both the line `tax_amount` snapshot
   * and the header `invoice_taxes` aggregate. Replaces the previous "single
   * tax_amount per line + header aggregate" model. Backward-compatible: if
   * omitted, the backend falls back to the legacy single-tax-amount path.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(10)
  @Type(() => CreateInvoiceTaxDto)
  taxes?: CreateInvoiceTaxDto[];

  /**
   * Per-line flag: INCLUDED in `unit_price` or ADDITIONAL on top. When omitted,
   * the backend derives it from the first item-level tax (`is_inclusive` on
   * `CreateInvoiceTaxDto`) or the catalog (`tax_rates.is_inclusive`); default
   * is ADDITIONAL for backward compatibility.
   */
  @IsOptional()
  @IsBoolean()
  is_inclusive?: boolean;
}

export class CreateInvoiceTaxDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  tax_rate_id?: number;

  @IsString()
  @MaxLength(100)
  tax_name: string;

  @IsNumber()
  @Type(() => Number)
  tax_rate: number;

  @IsNumber()
  @Type(() => Number)
  taxable_amount: number;

  @IsNumber()
  @Type(() => Number)
  tax_amount: number;

  /** Fiscal classification (iva/inc/ica/...). Defaults to iva when omitted. */
  @IsOptional()
  @IsEnum(TaxFiscalType)
  tax_type?: TaxFiscalType;

  /**
   * INCLUDED in `unit_price` (true) or ADDITIONAL on top (false). Defaults to
   * false (additional) when omitted. Drives the UBL DIAN builder's
   * `TaxInclusiveIndicator` XML attribute and the per-line desglose in the
   * frontend totals panel.
   */
  @IsOptional()
  @IsBoolean()
  is_inclusive?: boolean;
}

export class CreateInvoiceDto {
  @IsEnum([
    'sales_invoice',
    'purchase_invoice',
    'export_invoice',
    'support_document',
    'support_adjustment_note',
    'pos_equivalent_document',
    'equivalent_adjustment_note',
  ])
  invoice_type:
    | 'sales_invoice'
    | 'purchase_invoice'
    | 'export_invoice'
    | 'support_document'
    | 'support_adjustment_note'
    | 'pos_equivalent_document'
    | 'equivalent_adjustment_note';

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  customer_id?: number;

  /**
   * Inline customer creation payload. When present AND `customer_id` is
   * omitted, the backend creates a new `users` row (role='customer') inside
   * the same transaction as the invoice and uses the resulting `customer_id`.
   * Ignored when `customer_id` is provided. Full DIAN validators apply
   * (NIT+DV módulo 11, JuridicaNameRule, FiscalResponsibilityInCatalogRule).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCustomerDto)
  inline_customer?: CreateCustomerDto;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  supplier_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  related_invoice_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customer_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customer_tax_id?: string;

  @IsOptional()
  customer_address?: any;

  @IsDateString()
  issue_date: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  resolution_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  withholding_amount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Invoice line items. Capped at 100 entries (defensive ceiling; real
   * invoices rarely exceed ~50). Each line may carry an `inline_product`
   * payload to create a new product at the same time, plus per-line
   * `taxes[]` with `is_inclusive` to drive the INCLUDED / ADDITIONAL split.
   */
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  /**
   * Header-aggregated tax rows (one per `(tax_name, rate, type)`). Kept for
   * backward compatibility — new flows can omit this and use only
   * `items[].taxes[]` (the backend will aggregate them into
   * `invoice_taxes`).
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceTaxDto)
  taxes?: CreateInvoiceTaxDto[];
}
