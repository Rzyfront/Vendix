export interface LayawayPlan {
  id: number;
  store_id: number;
  customer_id: number;
  plan_number: string;
  state: 'active' | 'completed' | 'cancelled' | 'overdue' | 'defaulted';
  total_amount: number;
  down_payment_amount: number;
  paid_amount: number;
  remaining_amount: number;
  currency: string | null;
  num_installments: number;
  notes: string | null;
  internal_notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  customer?: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
  };
  created_by?: {
    id: number;
    first_name: string;
    last_name: string;
  };
  layaway_items?: LayawayItem[];
  layaway_installments?: LayawayInstallment[];
  layaway_payments?: LayawayPayment[];
}

export interface LayawayItem {
  id: number;
  layaway_plan_id: number;
  product_id: number;
  product_variant_id: number | null;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  subtotal: number;
  location_id: number | null;
  products?: { id: number; name: string; sku: string };
  product_variants?: { id: number; name: string; sku: string } | null;
  inventory_locations?: { id: number; name: string; code: string } | null;
}

export interface LayawayInstallment {
  id: number;
  layaway_plan_id: number;
  installment_number: number;
  amount: number;
  due_date: string;
  state: 'pending' | 'paid' | 'overdue' | 'cancelled';
  paid_at: string | null;
  reminder_sent_at: string | null;
}

export interface LayawayPayment {
  id: number;
  layaway_plan_id: number;
  layaway_installment_id: number | null;
  amount: number;
  currency: string | null;
  store_payment_method_id: number | null;
  transaction_id: string | null;
  state: string;
  paid_at: string | null;
  notes: string | null;
  received_by_user_id: number | null;
  store_payment_methods?: { id: number; display_name: string } | null;
  received_by?: { id: number; first_name: string; last_name: string } | null;
}

export interface LayawayStats {
  active: number;
  completed: number;
  overdue: number;
  total_receivable: number;
}

export interface CreateLayawayRequest {
  customer_id: number;
  currency?: string;
  down_payment_amount?: number;
  down_payment_method_id?: number;
  notes?: string;
  internal_notes?: string;
  items: {
    product_id: number;
    product_variant_id?: number;
    product_name: string;
    variant_name?: string;
    sku?: string;
    quantity: number;
    unit_price: number;
    discount_amount?: number;
    tax_amount?: number;
    location_id?: number;
  }[];
  installments: {
    amount: number;
    due_date: string;
  }[];
}

export interface MakePaymentRequest {
  amount: number;
  installment_id?: number;
  store_payment_method_id?: number;
  transaction_id?: string;
  notes?: string;
}

export interface ModifyInstallmentsRequest {
  installments: {
    id?: number;
    amount: number;
    due_date: string;
  }[];
}

export interface CancelLayawayRequest {
  cancellation_reason: string;
}

export interface LayawayQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  state?: string;
  customer_id?: number;
}
