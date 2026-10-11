import type { InvoiceProfileConfig } from '../../../../../core/utils/invoice-profile-config.contract';

export interface ContractQuotationCostLine {
  product_id?: number;
  product_variant_id?: number;
  product_name: string;
  variant_sku?: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  total_price: number;
}

export interface ContractQuotationEconomicsPreviewRequest {
  quotation_id?: number;
  invoice_profile_id?: number;
  contract_object?: string;
  due_date?: string | null;
  aiu_value?: number;
  items: ContractQuotationCostLine[];
}

export interface ContractQuotationEconomicSnapshot {
  schema_version: 1;
  frozen_at: string;
  invoice_profile: {
    profile_id: number;
    version: number;
    name: string;
    config: InvoiceProfileConfig;
  };
  quotation_profile?: { profile_id: number; version: number; config: unknown } | null;
  contract_object: string;
  due_date?: string | null;
  aiu_value: string;
  direct_cost: string;
  contract_value: string;
  invoice_lines: Array<{
    bucket: string;
    description?: string;
    quantity: string | number;
    unit_price: string | number;
    discount_amount?: string | number;
  }>;
  calculation: {
    lines?: Array<Record<string, unknown>>;
    totals: {
      gross_subtotal: string;
      discount_amount: string;
      tax_amount: string;
      total_amount: string;
    };
    aiu?: {
      taxable_base: string;
      taxable_basis: string;
      contract_value: string;
      aiu_value: string;
      minimum_base: string;
    } | null;
  };
}
