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

export interface ContractSnapshot {
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
}
