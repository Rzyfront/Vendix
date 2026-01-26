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
  on(ExpensesActions.createExpenseSuccess, (state, { expense }) => ({
    ...state,
    expenses: [...state.expenses, expense],
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
    expenses: state.expenses.map((e: any) =>
      e.id === expense.id ? expense : e,
    ),
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
    expenses: state.expenses.filter((e: any) => e.id !== id),
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

  // Approve/Reject Expense
  on(ExpensesActions.approveExpense, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(ExpensesActions.approveExpenseSuccess, (state, { expense }) => ({
    ...state,
    expenses: state.expenses.map((e: any) =>
      e.id === expense.id ? expense : e,
    ),
    currentExpense: expense,
    loading: false,
    error: null,
  })),
  on(ExpensesActions.approveExpenseFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(ExpensesActions.rejectExpense, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(ExpensesActions.rejectExpenseSuccess, (state, { expense }) => ({
    ...state,
    expenses: state.expenses.map((e: any) =>
      e.id === expense.id ? expense : e,
    ),
    currentExpense: expense,
    loading: false,
    error: null,
  })),
  on(ExpensesActions.rejectExpenseFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
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
    categories: state.categories.map((c: any) =>
      c.id === category.id ? category : c,
    ),
  })),

  on(ExpensesActions.deleteExpenseCategorySuccess, (state, { id }) => ({
    ...state,
    categories: state.categories.filter((c: any) => c.id !== id),
  })),

  // Clear State
  on(ExpensesActions.clearExpensesState, () => initialExpensesState),
);
