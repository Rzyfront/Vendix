import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, switchMap, exhaustMap, catchError, withLatestFrom } from 'rxjs/operators';
import { ExpensesService } from '../../services/expenses.service';
import * as ExpensesActions from '../actions/expenses.actions';
import { selectExpensesState } from '../selectors/expenses.selectors';

@Injectable()
export class ExpensesEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private expensesService = inject(ExpensesService);

  // Load expenses using filter-as-state from store
  loadExpenses$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.loadExpenses),
      withLatestFrom(this.store.select(selectExpensesState)),
      switchMap(([, state]) =>
        this.expensesService.getExpenses({
          page: state.page,
          limit: state.limit,
          search: state.search || undefined,
          sort_by: state.sortBy,
          sort_order: state.sortOrder,
          state: state.stateFilter || undefined,
          category_id: state.categoryFilter || undefined,
          date_from: state.dateFrom || undefined,
          date_to: state.dateTo || undefined,
        }).pipe(
          map((response) =>
            ExpensesActions.loadExpensesSuccess({ expenses: response.data, meta: response.meta })
          ),
          catchError((error) =>
            of(ExpensesActions.loadExpensesFailure({
              error: error.error?.message || error.message || 'Error loading expenses'
            }))
          )
        )
      )
    )
  );

  // Cascade: any filter change dispatches loadExpenses
  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        ExpensesActions.setSearch,
        ExpensesActions.setPage,
        ExpensesActions.setSort,
        ExpensesActions.setStateFilter,
        ExpensesActions.setCategoryFilter,
        ExpensesActions.setDateRange,
        ExpensesActions.clearFilters,
      ),
      map(() => ExpensesActions.loadExpenses())
    )
  );

  // After any mutation success, reload expenses + summary
  mutationSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        ExpensesActions.createExpenseSuccess,
        ExpensesActions.updateExpenseSuccess,
        ExpensesActions.deleteExpenseSuccess,
        ExpensesActions.approveExpenseSuccess,
        ExpensesActions.rejectExpenseSuccess,
        ExpensesActions.payExpenseSuccess,
        ExpensesActions.cancelExpenseSuccess,
      ),
      switchMap(() => [
        ExpensesActions.loadExpenses(),
        ExpensesActions.loadExpensesSummary(),
      ])
    )
  );

  // Load summary
  loadSummary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.loadExpensesSummary),
      switchMap(() =>
        this.expensesService.getExpensesSummary().pipe(
          map((response) =>
            ExpensesActions.loadExpensesSummarySuccess({ summary: response.data })
          ),
          catchError((error) =>
            of(ExpensesActions.loadExpensesSummaryFailure({
              error: error.error?.message || error.message || 'Error loading summary'
            }))
          )
        )
      )
    )
  );

  createExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.createExpense),
      switchMap(({ expense }) =>
        this.expensesService.createExpense(expense).pipe(
          map((response) =>
            ExpensesActions.createExpenseSuccess({ expense: response.data })
          ),
          catchError((error) =>
            of(ExpensesActions.createExpenseFailure({
              error: error.error?.message || error.message || 'Error creating expense'
            }))
          )
        )
      )
    )
  );

  updateExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.updateExpense),
      switchMap(({ id, expense }) =>
        this.expensesService.updateExpense(id, expense).pipe(
          map((response) =>
            ExpensesActions.updateExpenseSuccess({ expense: response.data })
          ),
          catchError((error) =>
            of(ExpensesActions.updateExpenseFailure({
              error: error.error?.message || error.message || 'Error updating expense'
            }))
          )
        )
      )
    )
  );

  deleteExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.deleteExpense),
      switchMap(({ id }) =>
        this.expensesService.deleteExpense(id).pipe(
          map(() => ExpensesActions.deleteExpenseSuccess({ id })),
          catchError((error) =>
            of(ExpensesActions.deleteExpenseFailure({
              error: error.error?.message || error.message || 'Error deleting expense'
            }))
          )
        )
      )
    )
  );

  approveExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.approveExpense),
      switchMap(({ id }) =>
        this.expensesService.approveExpense(id).pipe(
          map((response) => ExpensesActions.approveExpenseSuccess({ expense: response.data })),
          catchError((error) =>
            of(ExpensesActions.approveExpenseFailure({
              error: error.error?.message || error.message || 'Error approving expense'
            }))
          )
        )
      )
    )
  );

  rejectExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.rejectExpense),
      switchMap(({ id }) =>
        this.expensesService.rejectExpense(id).pipe(
          map((response) => ExpensesActions.rejectExpenseSuccess({ expense: response.data })),
          catchError((error) =>
            of(ExpensesActions.rejectExpenseFailure({
              error: error.error?.message || error.message || 'Error rejecting expense'
            }))
          )
        )
      )
    )
  );

  payExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.payExpense),
      switchMap(({ id }) =>
        this.expensesService.payExpense(id).pipe(
          map((response) => ExpensesActions.payExpenseSuccess({ expense: response.data })),
          catchError((error) =>
            of(ExpensesActions.payExpenseFailure({
              error: error.error?.message || error.message || 'Error marking expense as paid'
            }))
          )
        )
      )
    )
  );

  cancelExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.cancelExpense),
      switchMap(({ id }) =>
        this.expensesService.cancelExpense(id).pipe(
          map((response) => ExpensesActions.cancelExpenseSuccess({ expense: response.data })),
          catchError((error) =>
            of(ExpensesActions.cancelExpenseFailure({
              error: error.error?.message || error.message || 'Error cancelling expense'
            }))
          )
        )
      )
    )
  );

  loadCategories$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.loadExpenseCategories),
      exhaustMap(() =>
        this.expensesService.getExpenseCategories().pipe(
          map((response) =>
            ExpensesActions.loadExpenseCategoriesSuccess({ categories: response.data })
          ),
          catchError((error) =>
            of(ExpensesActions.loadExpenseCategoriesFailure({
              error: error.error?.message || error.message || 'Error loading categories'
            }))
          )
        )
      )
    )
  );

  createCategory$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.createExpenseCategory),
      switchMap(({ category }) =>
        this.expensesService.createExpenseCategory(category).pipe(
          map((response) =>
            ExpensesActions.createExpenseCategorySuccess({ category: response.data })
          ),
          catchError((error) =>
            of(ExpensesActions.createExpenseCategoryFailure({
              error: error.error?.message || error.message || 'Error creating category'
            }))
          )
        )
      )
    )
  );

  updateCategory$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.updateExpenseCategory),
      switchMap(({ id, category }) =>
        this.expensesService.updateExpenseCategory(id, category).pipe(
          map((response) =>
            ExpensesActions.updateExpenseCategorySuccess({ category: response.data })
          ),
          catchError((error) =>
            of(ExpensesActions.updateExpenseCategoryFailure({
              error: error.error?.message || error.message || 'Error updating category'
            }))
          )
        )
      )
    )
  );

  deleteCategory$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.deleteExpenseCategory),
      switchMap(({ id }) =>
        this.expensesService.deleteExpenseCategory(id).pipe(
          map(() => ExpensesActions.deleteExpenseCategorySuccess({ id })),
          catchError((error) =>
            of(ExpensesActions.deleteExpenseCategoryFailure({
              error: error.error?.message || error.message || 'Error deleting category'
            }))
          )
        )
      )
    )
  );
}
