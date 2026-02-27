import { createAction, props } from '@ngrx/store';
import {
  Expense,
  ExpenseCategory,
  ExpenseSummary,
  CreateExpenseDto,
  UpdateExpenseDto,
} from '../../interfaces/expense.interface';

// Load Expenses
export const loadExpenses = createAction('[Expenses] Load Expenses');
export const loadExpensesSuccess = createAction(
  '[Expenses] Load Expenses Success',
  props<{ expenses: Expense[]; meta: any }>(),
);
export const loadExpensesFailure = createAction(
  '[Expenses] Load Expenses Failure',
  props<{ error: string }>(),
);

// Load Single Expense
export const loadExpense = createAction(
  '[Expenses] Load Expense',
  props<{ id: number }>(),
);
export const loadExpenseSuccess = createAction(
  '[Expenses] Load Expense Success',
  props<{ expense: Expense }>(),
);
export const loadExpenseFailure = createAction(
  '[Expenses] Load Expense Failure',
  props<{ error: string }>(),
);

// Create Expense
export const createExpense = createAction(
  '[Expenses] Create Expense',
  props<{ expense: CreateExpenseDto }>(),
);
export const createExpenseSuccess = createAction(
  '[Expenses] Create Expense Success',
  props<{ expense: Expense }>(),
);
export const createExpenseFailure = createAction(
  '[Expenses] Create Expense Failure',
  props<{ error: string }>(),
);

// Update Expense
export const updateExpense = createAction(
  '[Expenses] Update Expense',
  props<{ id: number; expense: UpdateExpenseDto }>(),
);
export const updateExpenseSuccess = createAction(
  '[Expenses] Update Expense Success',
  props<{ expense: Expense }>(),
);
export const updateExpenseFailure = createAction(
  '[Expenses] Update Expense Failure',
  props<{ error: string }>(),
);

// Delete Expense
export const deleteExpense = createAction(
  '[Expenses] Delete Expense',
  props<{ id: number }>(),
);
export const deleteExpenseSuccess = createAction(
  '[Expenses] Delete Expense Success',
  props<{ id: number }>(),
);
export const deleteExpenseFailure = createAction(
  '[Expenses] Delete Expense Failure',
  props<{ error: string }>(),
);

// State Transitions (via ExpenseFlowService)
export const approveExpense = createAction(
  '[Expenses] Approve Expense',
  props<{ id: number }>(),
);
export const approveExpenseSuccess = createAction(
  '[Expenses] Approve Expense Success',
  props<{ expense: Expense }>(),
);
export const approveExpenseFailure = createAction(
  '[Expenses] Approve Expense Failure',
  props<{ error: string }>(),
);

export const rejectExpense = createAction(
  '[Expenses] Reject Expense',
  props<{ id: number }>(),
);
export const rejectExpenseSuccess = createAction(
  '[Expenses] Reject Expense Success',
  props<{ expense: Expense }>(),
);
export const rejectExpenseFailure = createAction(
  '[Expenses] Reject Expense Failure',
  props<{ error: string }>(),
);

export const payExpense = createAction(
  '[Expenses] Pay Expense',
  props<{ id: number }>(),
);
export const payExpenseSuccess = createAction(
  '[Expenses] Pay Expense Success',
  props<{ expense: Expense }>(),
);
export const payExpenseFailure = createAction(
  '[Expenses] Pay Expense Failure',
  props<{ error: string }>(),
);

export const cancelExpense = createAction(
  '[Expenses] Cancel Expense',
  props<{ id: number }>(),
);
export const cancelExpenseSuccess = createAction(
  '[Expenses] Cancel Expense Success',
  props<{ expense: Expense }>(),
);
export const cancelExpenseFailure = createAction(
  '[Expenses] Cancel Expense Failure',
  props<{ error: string }>(),
);

// Summary
export const loadExpensesSummary = createAction('[Expenses] Load Summary');
export const loadExpensesSummarySuccess = createAction(
  '[Expenses] Load Summary Success',
  props<{ summary: ExpenseSummary }>(),
);
export const loadExpensesSummaryFailure = createAction(
  '[Expenses] Load Summary Failure',
  props<{ error: string }>(),
);

// Filter setters (filter-as-state pattern)
export const setSearch = createAction(
  '[Expenses] Set Search',
  props<{ search: string }>(),
);
export const setPage = createAction(
  '[Expenses] Set Page',
  props<{ page: number }>(),
);
export const setSort = createAction(
  '[Expenses] Set Sort',
  props<{ sortBy: string; sortOrder: 'asc' | 'desc' }>(),
);
export const setStateFilter = createAction(
  '[Expenses] Set State Filter',
  props<{ stateFilter: string }>(),
);
export const setCategoryFilter = createAction(
  '[Expenses] Set Category Filter',
  props<{ categoryFilter: number | null }>(),
);
export const setDateRange = createAction(
  '[Expenses] Set Date Range',
  props<{ dateFrom: string; dateTo: string }>(),
);
export const clearFilters = createAction('[Expenses] Clear Filters');

// Expense Categories
export const loadExpenseCategories = createAction(
  '[Expenses] Load Expense Categories',
);
export const loadExpenseCategoriesSuccess = createAction(
  '[Expenses] Load Expense Categories Success',
  props<{ categories: ExpenseCategory[] }>(),
);
export const loadExpenseCategoriesFailure = createAction(
  '[Expenses] Load Expense Categories Failure',
  props<{ error: string }>(),
);

export const createExpenseCategory = createAction(
  '[Expenses] Create Expense Category',
  props<{ category: Partial<ExpenseCategory> }>(),
);
export const createExpenseCategorySuccess = createAction(
  '[Expenses] Create Expense Category Success',
  props<{ category: ExpenseCategory }>(),
);
export const createExpenseCategoryFailure = createAction(
  '[Expenses] Create Expense Category Failure',
  props<{ error: string }>(),
);

export const updateExpenseCategory = createAction(
  '[Expenses] Update Expense Category',
  props<{ id: number; category: Partial<ExpenseCategory> }>(),
);
export const updateExpenseCategorySuccess = createAction(
  '[Expenses] Update Expense Category Success',
  props<{ category: ExpenseCategory }>(),
);
export const updateExpenseCategoryFailure = createAction(
  '[Expenses] Update Expense Category Failure',
  props<{ error: string }>(),
);

export const deleteExpenseCategory = createAction(
  '[Expenses] Delete Expense Category',
  props<{ id: number }>(),
);
export const deleteExpenseCategorySuccess = createAction(
  '[Expenses] Delete Expense Category Success',
  props<{ id: number }>(),
);
export const deleteExpenseCategoryFailure = createAction(
  '[Expenses] Delete Expense Category Failure',
  props<{ error: string }>(),
);

// Clear State
export const clearExpensesState = createAction('[Expenses] Clear State');
