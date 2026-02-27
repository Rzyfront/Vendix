import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ExpensesState } from '../expenses.state';
import { ExpenseCategory } from '../../interfaces/expense.interface';

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

// Summary (from backend, NOT derived client-side)
export const selectSummary = createSelector(
  selectExpensesState,
  (state) => state.summary,
);

export const selectLoadingSummary = createSelector(
  selectExpensesState,
  (state) => state.loadingSummary,
);

// Filter selectors
export const selectSearch = createSelector(
  selectExpensesState,
  (state) => state.search,
);

export const selectPage = createSelector(
  selectExpensesState,
  (state) => state.page,
);

export const selectLimit = createSelector(
  selectExpensesState,
  (state) => state.limit,
);

export const selectSortBy = createSelector(
  selectExpensesState,
  (state) => state.sortBy,
);

export const selectSortOrder = createSelector(
  selectExpensesState,
  (state) => state.sortOrder,
);

export const selectStateFilter = createSelector(
  selectExpensesState,
  (state) => state.stateFilter,
);

export const selectCategoryFilter = createSelector(
  selectExpensesState,
  (state) => state.categoryFilter,
);

export const selectDateFrom = createSelector(
  selectExpensesState,
  (state) => state.dateFrom,
);

export const selectDateTo = createSelector(
  selectExpensesState,
  (state) => state.dateTo,
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

export const selectActiveExpenseCategories = createSelector(
  selectExpenseCategories,
  (categories: ExpenseCategory[]) =>
    categories.filter((category: ExpenseCategory) => category.is_active),
);
