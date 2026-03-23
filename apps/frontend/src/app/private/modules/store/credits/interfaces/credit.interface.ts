export interface Credit {
  id: number;
  store_id: number;
  order_id: number;
  customer_id: number;
  credit_number: string;
  total_amount: number;
  total_paid: number;
  remaining_balance: number;
  num_installments: number;
  installment_value: number;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  interest_rate: number;
  start_date: string;
  first_installment_date: string;
  state: CreditState;
  default_payment_method_id: number | null;
  notes: string | null;
  created_by_user_id: number | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  customer?: { id: number; first_name: string; last_name: string; phone: string; email?: string; credit_limit?: number };
  orders?: { id: number; order_number: string; grand_total: number };
  installments?: CreditInstallment[];
  created_by?: { id: number; first_name: string; last_name: string };
}

export type CreditState = 'pending' | 'active' | 'paid' | 'overdue' | 'cancelled' | 'defaulted';

export interface CreditInstallment {
  id: number;
  credit_id: number;
  installment_number: number;
  installment_value: number;
  capital_value: number;
  interest_value: number;
  amount_paid: number;
  remaining_balance: number;
  due_date: string;
  payment_date: string | null;
  state: 'pending' | 'paid' | 'overdue' | 'partial' | 'forgiven';
  credit_installment_payments?: CreditInstallmentPayment[];
}

export interface CreditInstallmentPayment {
  id: number;
  installment_id: number;
  amount_paid: number;
  payment_date: string;
  store_payment_method_id: number | null;
  payment_reference: string | null;
  notes: string | null;
  store_payment_methods?: { id: number; display_name: string };
  registered_by?: { id: number; first_name: string; last_name: string };
}

export interface CreditStats {
  active_credits: number;
  total_pending: number;
  overdue_installments: number;
  monthly_collection: number;
}

export interface RegisterPaymentRequest {
  installment_id: number;
  amount: number;
  store_payment_method_id?: number;
  payment_reference?: string;
  notes?: string;
}

export interface CreditQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  state?: string;
  customer_id?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}
