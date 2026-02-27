import { createReducer, on } from '@ngrx/store';
import { ExpensesState, initialExpensesState } from '../expenses.state';
import * as ExpensesActions from '../actions/expenses.actions';

export const expensesReducer = createReducer(
  initialExpensesState,

  // Load Expenses
  on(ExpensesActions.loadExpenses, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(ExpensesActions.loadExpensesSuccess, (state, { expenses, meta }) => ({
    ...state,
    expenses,
    meta,
    loading: false,
    error: null,
  })),
  on(ExpensesActions.loadExpensesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // Load Single Expense
  on(ExpensesActions.loadExpense, (state) => ({
    ...state,
    currentExpenseLoading: true,
    error: null,
  })),
  on(ExpensesActions.loadExpenseSuccess, (state, { expense }) => ({
    ...state,
    currentExpense: expense,
    currentExpenseLoading: false,
    error: null,
  })),
  on(ExpensesActions.loadExpenseFailure, (state, { error }) => ({
    ...state,
    currentExpenseLoading: false,
    error,
  })),

  // Create Expense
  on(ExpensesActions.createExpense, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(ExpensesActions.createExpenseSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
  })),
  on(ExpensesActions.createExpenseFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // Update Expense
  on(ExpensesActions.updateExpense, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(ExpensesActions.updateExpenseSuccess, (state, { expense }) => ({
    ...state,
    currentExpense: expense,
    loading: false,
    error: null,
  })),
  on(ExpensesActions.updateExpenseFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // Delete Expense
  on(ExpensesActions.deleteExpense, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(ExpensesActions.deleteExpenseSuccess, (state, { id }) => ({
    ...state,
    currentExpense:
      state.currentExpense?.id === id ? null : state.currentExpense,
    loading: false,
    error: null,
  })),
  on(ExpensesActions.deleteExpenseFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // State Transitions (approve/reject/pay/cancel) — all reload via effects
  on(
    ExpensesActions.approveExpense,
    ExpensesActions.rejectExpense,
    ExpensesActions.payExpense,
    ExpensesActions.cancelExpense,
    (state) => ({
      ...state,
      loading: true,
      error: null,
    }),
  ),
  on(
    ExpensesActions.approveExpenseSuccess,
    ExpensesActions.rejectExpenseSuccess,
    ExpensesActions.payExpenseSuccess,
    ExpensesActions.cancelExpenseSuccess,
    (state, { expense }) => ({
      ...state,
      currentExpense: expense,
      loading: false,
      error: null,
    }),
  ),
  on(
    ExpensesActions.approveExpenseFailure,
    ExpensesActions.rejectExpenseFailure,
    ExpensesActions.payExpenseFailure,
    ExpensesActions.cancelExpenseFailure,
    (state, { error }) => ({
      ...state,
      loading: false,
      error,
    }),
  ),

  // Summary
  on(ExpensesActions.loadExpensesSummary, (state) => ({
    ...state,
    loadingSummary: true,
  })),
  on(ExpensesActions.loadExpensesSummarySuccess, (state, { summary }) => ({
    ...state,
    summary,
    loadingSummary: false,
  })),
  on(ExpensesActions.loadExpensesSummaryFailure, (state) => ({
    ...state,
    loadingSummary: false,
  })),

  // Filter setters — each resets page to 1 (except setPage itself)
  on(ExpensesActions.setSearch, (state, { search }) => ({
    ...state,
    search,
    page: 1,
  })),
  on(ExpensesActions.setPage, (state, { page }) => ({
    ...state,
    page,
  })),
  on(ExpensesActions.setSort, (state, { sortBy, sortOrder }) => ({
    ...state,
    sortBy,
    sortOrder,
    page: 1,
  })),
  on(ExpensesActions.setStateFilter, (state, { stateFilter }) => ({
    ...state,
    stateFilter,
    page: 1,
  })),
  on(ExpensesActions.setCategoryFilter, (state, { categoryFilter }) => ({
    ...state,
    categoryFilter,
    page: 1,
  })),
  on(ExpensesActions.setDateRange, (state, { dateFrom, dateTo }) => ({
    ...state,
    dateFrom,
    dateTo,
    page: 1,
  })),
  on(ExpensesActions.clearFilters, (state) => ({
    ...state,
    search: '',
    page: 1,
    stateFilter: '',
    categoryFilter: null,
    dateFrom: '',
    dateTo: '',
  })),

  // Expense Categories
  on(ExpensesActions.loadExpenseCategories, (state) => ({
    ...state,
    categoriesLoading: true,
    error: null,
  })),
  on(ExpensesActions.loadExpenseCategoriesSuccess, (state, { categories }) => ({
    ...state,
    categories,
    categoriesLoading: false,
    error: null,
  })),
  on(ExpensesActions.loadExpenseCategoriesFailure, (state, { error }) => ({
    ...state,
    categoriesLoading: false,
    error,
  })),

  on(ExpensesActions.createExpenseCategorySuccess, (state, { category }) => ({
    ...state,
    categories: [...state.categories, category],
  })),

  on(ExpensesActions.updateExpenseCategorySuccess, (state, { category }) => ({
    ...state,
    categories: state.categories.map((c) =>
      c.id === category.id ? category : c,
    ),
  })),

  on(ExpensesActions.deleteExpenseCategorySuccess, (state, { id }) => ({
    ...state,
    categories: state.categories.filter((c) => c.id !== id),
  })),

  // Clear State
  on(ExpensesActions.clearExpensesState, () => initialExpensesState),
);
