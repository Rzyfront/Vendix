export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  category_id?: string;
  category_name?: string;
  state: 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled' | 'refunded';
  notes?: string;
  created_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  description?: string;
}

export interface ExpenseStats {
  total: number;
  totalAmount: number;
  pending: number;
  approved: number;
  paid: number;
}

export interface CreateExpenseDto {
  description: string;
  amount: number;
  date: string;
  category_id?: string;
  notes?: string;
}
