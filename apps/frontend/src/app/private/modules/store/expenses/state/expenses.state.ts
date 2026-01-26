import { Expense, ExpenseCategory } from '../interfaces/expense.interface';

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
    total_pages: number;
  } | null;
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
};
