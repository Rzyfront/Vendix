export type CustomerState = 'active' | 'inactive';

/** Espejo web `tax_regime` — clasificación fiscal del cliente. */
export type TaxRegime = 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE';

/** Espejo web `person_type` — tipo de persona (natural/jurídica). */
export type PersonType = 'NATURAL' | 'JURIDICA';

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  document_type?: string;
  document_number?: string;
  /**
   * Clasificación fiscal del cliente (espejo web TaxRegime).
   * El backend lo devuelve opcional; el form de edición lo persiste.
   */
  tax_regime?: TaxRegime | string | null;
  /**
   * Tipo de persona del cliente (espejo web PersonType).
   * El backend lo devuelve opcional; el form de edición lo persiste.
   */
  person_type?: PersonType | string | null;
  /**
   * Si el cliente es responsable de practicar retenciones (espejo web
   * customer-modal.component.ts: `is_withholding_agent`).
   */
  is_withholding_agent?: boolean;
  state: CustomerState;
  created_at: string;
  total_orders?: number;
  total_spent?: number;
  last_purchase_at?: string;
  wallet_balance?: number;
  wallet_held?: number;
}

export interface CustomerWalletTransaction {
  id: string;
  type: 'topup' | 'payment' | 'adjustment' | 'refund';
  amount: number;
  description: string;
  created_at: string;
}

export interface CustomerWithWallet extends Customer {
  wallet_transactions?: CustomerWalletTransaction[];
}

export interface CustomerStats {
  total_customers: number;
  active_customers: number;
  new_customers_this_month: number;
  total_revenue: number;
}

export interface CustomerQuery {
  page?: number;
  limit?: number;
  search?: string;
  state?: CustomerState;
}

export interface CreateCustomerDto {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  document_type?: string;
  document_number?: string;
  tax_regime?: string;
  person_type?: string;
  is_withholding_agent?: boolean;
  state?: CustomerState;
}

export interface UpdateCustomerDto extends Partial<CreateCustomerDto> {}

export interface BulkCustomerUploadResult {
  success: boolean;
  total_processed: number;
  successful: number;
  failed: number;
  results: BulkCustomerUploadItemResult[];
}

export interface BulkCustomerUploadItemResult {
  status: 'success' | 'error';
  message?: string;
  error?: string;
  row_number?: number;
  customer?: { id: string };
}
