import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaxFiscalType } from '../../taxes/dto';

export class CreateInvoiceItemDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  product_variant_id?: number;

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
}

export class CreateInvoiceDto {
  @IsEnum([
    'sales_invoice',
    'purchase_invoice',
    'export_invoice',
    'support_document',
    'support_adjustment_note',
  ])
  invoice_type:
    | 'sales_invoice'
    | 'purchase_invoice'
    | 'export_invoice'
    | 'support_document'
    | 'support_adjustment_note';

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  customer_id?: number;

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceTaxDto)
  taxes?: CreateInvoiceTaxDto[];
}
