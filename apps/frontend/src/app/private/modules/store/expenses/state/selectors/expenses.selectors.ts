import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ExpensesState } from '../expenses.state';
import { Expense, ExpenseCategory } from '../../interfaces/expense.interface';

export const selectExpensesState =
  createFeatureSelector<ExpensesState>('expenses');

// Expenses
export const selectExpenses = createSelector(
  selectExpensesState,
  (state) => state.expenses,
);

export const selectExpensesLoading = createSelector(
  selectExpensesState,
  (state) => state.loading,
);

export const selectExpensesError = createSelector(
  selectExpensesState,
  (state) => state.error,
);

export const selectExpensesMeta = createSelector(
  selectExpensesState,
  (state) => state.meta,
);

// Current Expense
export const selectCurrentExpense = createSelector(
  selectExpensesState,
  (state) => state.currentExpense,
);

export const selectCurrentExpenseLoading = createSelector(
  selectExpensesState,
  (state) => state.currentExpenseLoading,
);

// Expense Categories
export const selectExpenseCategories = createSelector(
  selectExpensesState,
  (state) => state.categories,
);

export const selectExpenseCategoriesLoading = createSelector(
  selectExpensesState,
  (state) => state.categoriesLoading,
);

// Derived selectors
export const selectPendingExpenses = createSelector(
  selectExpenses,
  (expenses: Expense[]) =>
    expenses.filter((expense: Expense) => expense.state === 'pending'),
);

export const selectApprovedExpenses = createSelector(
  selectExpenses,
  (expenses: Expense[]) =>
    expenses.filter((expense: Expense) => expense.state === 'approved'),
);

export const selectRejectedExpenses = createSelector(
  selectExpenses,
  (expenses: Expense[]) =>
    expenses.filter((expense: Expense) => expense.state === 'rejected'),
);

export const selectPaidExpenses = createSelector(
  selectExpenses,
  (expenses: Expense[]) =>
    expenses.filter((expense: Expense) => expense.state === 'paid'),
);

export const selectTotalExpensesAmount = createSelector(
  selectExpenses,
  (expenses: Expense[]) =>
    expenses.reduce(
      (total: number, expense: Expense) => total + expense.amount,
      0,
    ),
);

export const selectActiveExpenseCategories = createSelector(
  selectExpenseCategories,
  (categories: ExpenseCategory[]) =>
    categories.filter((category: ExpenseCategory) => category.is_active),
);
