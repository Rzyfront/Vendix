import { Expense, ExpenseCategory, ExpenseSummary } from '../interfaces/expense.interface';

export interface ExpensesState {
  expenses: Expense[];
  categories: ExpenseCategory[];
  loading: boolean;
  categoriesLoading: boolean;
  currentExpense: Expense | null;
  currentExpenseLoading: boolean;
  error: string | null;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } | null;

  // Summary from backend
  summary: ExpenseSummary | null;
  loadingSummary: boolean;

  // Filter-as-state
  search: string;
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  stateFilter: string;
  categoryFilter: number | null;
  dateFrom: string;
  dateTo: string;
}

export const initialExpensesState: ExpensesState = {
  expenses: [],
  categories: [],
  loading: false,
  categoriesLoading: false,
  currentExpense: null,
  currentExpenseLoading: false,
  error: null,
  meta: null,

  summary: null,
  loadingSummary: false,

  search: '',
  page: 1,
  limit: 10,
  sortBy: 'created_at',
  sortOrder: 'desc',
  stateFilter: '',
  categoryFilter: null,
  dateFrom: '',
  dateTo: '',
};
