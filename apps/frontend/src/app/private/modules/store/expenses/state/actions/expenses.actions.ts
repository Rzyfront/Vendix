import { createAction, props } from '@ngrx/store';
import {
  Expense,
  ExpenseCategory,
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

// Approve/Reject Expense
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
