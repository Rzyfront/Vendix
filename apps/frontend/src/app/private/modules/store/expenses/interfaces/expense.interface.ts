export interface Expense {
  id: number;
  store_id: number;
  organization_id: number;
  category_id?: number;
  amount: number;
  currency?: string;
  description?: string;
  expense_date: Date;
  state: 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';
  receipt_url?: string;
  notes?: string;
  created_by_user_id?: number;
  approved_by_user_id?: number;
  approved_at?: Date;
  created_at: Date;
  updated_at: Date;

  // Relations
  expense_categories?: ExpenseCategory;
  created_by_user?: {
    id: number;
    first_name?: string;
    last_name?: string;
  };
  approved_by_user?: {
    id: number;
    first_name?: string;
    last_name?: string;
  };
}

export interface ExpenseCategory {
  id: number;
  organization_id: number;
  name: string;
  description?: string;
  color?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateExpenseDto {
  category_id?: number;
  amount: number;
  currency?: string;
  description?: string;
  expense_date: Date;
  receipt_url?: string;
  notes?: string;
}

export interface UpdateExpenseDto {
  category_id?: number;
  amount?: number;
  currency?: string;
  description?: string;
  expense_date?: Date;
  receipt_url?: string;
  notes?: string;
}

export interface QueryExpenseDto {
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  state?: string;
  category_id?: number;
  date_from?: string;
  date_to?: string;
}

export interface ExpenseSummary {
  total_amount: number;
  total_count: number;
  counts_by_state: {
    pending: number;
    approved: number;
    rejected: number;
    paid: number;
    cancelled: number;
  };
  category_breakdown: Array<{
    category_id: number;
    category_name: string;
    color: string;
    total_amount: number;
    count: number;
  }>;
}

export interface ExpenseListResponse {
  data: Expense[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp?: string;
  path?: string;
}
