export type CustomerState = 'active' | 'inactive';

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  document_number?: string;
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
  total: number;
  active: number;
  newThisMonth: number;
  totalRevenue: number;
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
  document_number?: string;
  state?: CustomerState;
}

export interface UpdateCustomerDto extends Partial<CreateCustomerDto> {}
