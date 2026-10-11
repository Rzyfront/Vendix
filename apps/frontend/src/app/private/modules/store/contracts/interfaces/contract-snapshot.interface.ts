/** Raw JSON congelado por el backend. Decimal values intentionally remain strings. */
export interface ContractSnapshotItem {
  product_name?: string;
  quantity?: number | string;
  unit_price?: string | null;
  discount_amount?: string | null;
  tax_rate?: string | null;
  tax_amount_item?: string | null;
  total_price?: string | null;
  notes?: string | null;
  [key: string]: unknown;
}

export interface ContractSnapshotInvoiceProfile {
  profile_id?: number;
  version?: number;
  name?: string;
  config?: Record<string, unknown> | null;
}

export interface ContractSnapshotEconomicLine extends Record<string, unknown> {
  description?: string;
  bucket?: string;
  aiu_component?: string | null;
  quantity?: number | string;
  unit_price?: number | string;
  discount_amount?: number | string | null;
  taxes?: unknown[];
}

/** Exact, immutable economic snapshot copied from the accepted quotation. */
export interface ContractSnapshotEconomic {
  schema_version?: number;
  frozen_at?: string | null;
  invoice_profile?: ContractSnapshotInvoiceProfile | null;
  quotation_profile?: {
    profile_id?: number;
    version?: number;
    config?: Record<string, unknown> | null;
  } | null;
  contract_object?: string | null;
  direct_cost?: number | string | null;
  contract_value?: number | string | null;
  aiu_value?: number | string | null;
  invoice_lines?: ContractSnapshotEconomicLine[];
  calculation?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ContractSnapshot {
  schema_version?: number;
  frozen_at?: string | null;
  quotation?: {
    id?: number;
    quotation_number?: string;
    destination?: string;
    status?: string;
    subtotal_amount?: string | null;
    discount_amount?: string | null;
    tax_amount?: string | null;
    grand_total?: string | null;
    valid_until?: string | null;
    notes?: string | null;
    terms_and_conditions?: string | null;
    accepted_at?: string | null;
    contract_object?: string | null;
    items?: ContractSnapshotItem[];
    [key: string]: unknown;
  };
  profile?: {
    profile_id?: number;
    version?: number;
    config?: {
      admin_percent?: string | number | null;
      contingency_percent?: string | number | null;
      profit_percent?: string | number | null;
      validity_days?: number | null;
      payment_terms?: string | null;
      notes?: string | null;
      [key: string]: unknown;
    } | null;
  } | null;
  economic?: ContractSnapshotEconomic | null;
}
