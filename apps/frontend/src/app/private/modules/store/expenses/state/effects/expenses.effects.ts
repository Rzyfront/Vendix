import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import {
  map,
  switchMap,
  exhaustMap,
  catchError,
  withLatestFrom,
  tap,
} from 'rxjs/operators';
import { ExpensesService } from '../../services/expenses.service';
import { ReportsDataService } from '../../../reports/services/reports-data.service';
import { AnalyticsService } from '../../../analytics/services/analytics.service';
import { AnalyticsRefreshService } from '../../../shared/services/analytics-refresh.service';
import * as ExpensesActions from '../actions/expenses.actions';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { selectExpensesState } from '../selectors/expenses.selectors';

@Injectable()
export class ExpensesEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private expensesService = inject(ExpensesService);
  private reportsDataService = inject(ReportsDataService);
  private analyticsService = inject(AnalyticsService);
  private analyticsRefresh = inject(AnalyticsRefreshService);
  private toastService = inject(ToastService);

  // Load expenses using filter-as-state from store
  loadExpenses$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.loadExpenses),
      withLatestFrom(this.store.select(selectExpensesState)),
      switchMap(([, state]) =>
        this.expensesService
          .getExpenses({
            page: state.page,
            limit: state.limit,
            search: state.search || undefined,
            sort_by: state.sortBy,
            sort_order: state.sortOrder,
            state: state.stateFilter || undefined,
            category_id: state.categoryFilter || undefined,
            date_from: state.dateFrom || undefined,
            date_to: state.dateTo || undefined,
          })
          .pipe(
            map((response) =>
              ExpensesActions.loadExpensesSuccess({
                expenses: response.data,
                meta: response.meta,
              }),
            ),
            catchError((error) =>
              of(
                ExpensesActions.loadExpensesFailure({
                  error:
                    error.error?.message ||
                    error.message ||
                    'Error loading expenses',
                }),
              ),
            ),
          ),
      ),
    ),
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
      map(() => ExpensesActions.loadExpenses()),
    ),
  );

  // After any mutation success, reload expenses + summary and clear report/analytics caches.
  // Architectural rationale for cross-domain cache invalidation:
  // Expense mutations directly impact financial health metrics, operational cash,
  // tax summaries, and multiple report tables (expense summary, cash flow, profit & loss).
  // Purging ReportsDataService cache, invalidating AnalyticsService cache, and triggering
  // AnalyticsRefreshService ensures that navigating back to analytics or reports displays
  // accurate data immediately without requiring a browser refresh or waiting for TTL expiry.
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
        ExpensesActions.refundExpenseSuccess,
      ),
      tap(() => {
        this.reportsDataService.clearCache();
        this.analyticsService.invalidateCache();
        this.analyticsRefresh.triggerRefresh();
      }),
      switchMap(() => [
        ExpensesActions.loadExpenses(),
        ExpensesActions.loadExpensesSummary(),
      ]),
    ),
  );

  // Load summary
  loadSummary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.loadExpensesSummary),
      switchMap(() =>
        this.expensesService.getExpensesSummary().pipe(
          map((response) =>
            ExpensesActions.loadExpensesSummarySuccess({
              summary: response.data,
            }),
          ),
          catchError((error) =>
            of(
              ExpensesActions.loadExpensesSummaryFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error loading summary',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  createExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.createExpense),
      switchMap(({ expense }) =>
        this.expensesService.createExpense(expense).pipe(
          map((response) =>
            ExpensesActions.createExpenseSuccess({ expense: response.data }),
          ),
          catchError((error) =>
            of(
              ExpensesActions.createExpenseFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error creating expense',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  updateExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.updateExpense),
      switchMap(({ id, expense }) =>
        this.expensesService.updateExpense(id, expense).pipe(
          map((response) =>
            ExpensesActions.updateExpenseSuccess({ expense: response.data }),
          ),
          catchError((error) =>
            of(
              ExpensesActions.updateExpenseFailure({
                error: parseApiError(error).userMessage,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  deleteExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.deleteExpense),
      switchMap(({ id }) =>
        this.expensesService.deleteExpense(id).pipe(
          map(() => ExpensesActions.deleteExpenseSuccess({ id })),
          catchError((error) =>
            of(
              ExpensesActions.deleteExpenseFailure({
                error: parseApiError(error).userMessage,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  approveExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.approveExpense),
      switchMap(({ id }) =>
        this.expensesService.approveExpense(id).pipe(
          map((response) =>
            ExpensesActions.approveExpenseSuccess({ expense: response.data }),
          ),
          catchError((error) =>
            of(
              ExpensesActions.approveExpenseFailure({
                error: parseApiError(error).userMessage,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  rejectExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.rejectExpense),
      switchMap(({ id }) =>
        this.expensesService.rejectExpense(id).pipe(
          map((response) =>
            ExpensesActions.rejectExpenseSuccess({ expense: response.data }),
          ),
          catchError((error) =>
            of(
              ExpensesActions.rejectExpenseFailure({
                error: parseApiError(error).userMessage,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  payExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.payExpense),
      switchMap(({ id }) =>
        this.expensesService.payExpense(id).pipe(
          map((response) =>
            ExpensesActions.payExpenseSuccess({ expense: response.data }),
          ),
          catchError((error) =>
            of(
              ExpensesActions.payExpenseFailure({
                error: parseApiError(error).userMessage,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  cancelExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.cancelExpense),
      switchMap(({ id }) =>
        this.expensesService.cancelExpense(id).pipe(
          map((response) =>
            ExpensesActions.cancelExpenseSuccess({ expense: response.data }),
          ),
          catchError((error) =>
            of(
              ExpensesActions.cancelExpenseFailure({
                error: parseApiError(error).userMessage,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  refundExpense$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.refundExpense),
      switchMap(({ id, reason }) =>
        this.expensesService.refundExpense(id, reason).pipe(
          map((response) =>
            ExpensesActions.refundExpenseSuccess({ expense: response.data }),
          ),
          catchError((error) =>
            of(
              ExpensesActions.refundExpenseFailure({
                error: parseApiError(error).userMessage,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  loadCategories$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.loadExpenseCategories),
      exhaustMap(() =>
        this.expensesService.getExpenseCategories().pipe(
          map((response) =>
            ExpensesActions.loadExpenseCategoriesSuccess({
              categories: response.data,
            }),
          ),
          catchError((error) =>
            of(
              ExpensesActions.loadExpenseCategoriesFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error loading categories',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  createCategory$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.createExpenseCategory),
      switchMap(({ category }) =>
        this.expensesService.createExpenseCategory(category).pipe(
          map((response) =>
            ExpensesActions.createExpenseCategorySuccess({
              category: response.data,
            }),
          ),
          catchError((error) =>
            of(
              ExpensesActions.createExpenseCategoryFailure({
                error: parseApiError(error).userMessage,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  updateCategory$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.updateExpenseCategory),
      switchMap(({ id, category }) =>
        this.expensesService.updateExpenseCategory(id, category).pipe(
          map((response) =>
            ExpensesActions.updateExpenseCategorySuccess({
              category: response.data,
            }),
          ),
          catchError((error) =>
            of(
              ExpensesActions.updateExpenseCategoryFailure({
                error: parseApiError(error).userMessage,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  deleteCategory$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ExpensesActions.deleteExpenseCategory),
      switchMap(({ id }) =>
        this.expensesService.deleteExpenseCategory(id).pipe(
          map(() => ExpensesActions.deleteExpenseCategorySuccess({ id })),
          catchError((error) =>
            of(
              ExpensesActions.deleteExpenseCategoryFailure({
                error: parseApiError(error).userMessage,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // Toasts de éxito/error de mutaciones (createExpense lo avisa el componente)
  mutationSuccessToast$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          ExpensesActions.updateExpenseSuccess,
          ExpensesActions.deleteExpenseSuccess,
          ExpensesActions.approveExpenseSuccess,
          ExpensesActions.rejectExpenseSuccess,
          ExpensesActions.payExpenseSuccess,
          ExpensesActions.cancelExpenseSuccess,
          ExpensesActions.refundExpenseSuccess,
          ExpensesActions.createExpenseCategorySuccess,
          ExpensesActions.updateExpenseCategorySuccess,
          ExpensesActions.deleteExpenseCategorySuccess,
        ),
        tap((action) => {
          const messages: Record<string, string> = {
            [ExpensesActions.updateExpenseSuccess.type]: 'Gasto actualizado',
            [ExpensesActions.deleteExpenseSuccess.type]: 'Gasto eliminado',
            [ExpensesActions.approveExpenseSuccess.type]: 'Gasto aprobado',
            [ExpensesActions.rejectExpenseSuccess.type]: 'Gasto rechazado',
            [ExpensesActions.payExpenseSuccess.type]: 'Gasto marcado como pagado',
            [ExpensesActions.cancelExpenseSuccess.type]: 'Gasto cancelado',
            [ExpensesActions.refundExpenseSuccess.type]: 'Gasto reembolsado',
            [ExpensesActions.createExpenseCategorySuccess.type]: 'Categoría creada',
            [ExpensesActions.updateExpenseCategorySuccess.type]: 'Categoría actualizada',
            [ExpensesActions.deleteExpenseCategorySuccess.type]: 'Categoría eliminada',
          };
          this.toastService.success(messages[action.type] || 'Operación exitosa');
        }),
      ),
    { dispatch: false },
  );

  mutationFailureToast$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          ExpensesActions.updateExpenseFailure,
          ExpensesActions.deleteExpenseFailure,
          ExpensesActions.approveExpenseFailure,
          ExpensesActions.rejectExpenseFailure,
          ExpensesActions.payExpenseFailure,
          ExpensesActions.cancelExpenseFailure,
          ExpensesActions.refundExpenseFailure,
          ExpensesActions.createExpenseCategoryFailure,
          ExpensesActions.updateExpenseCategoryFailure,
          ExpensesActions.deleteExpenseCategoryFailure,
        ),
        tap(({ error }) => this.toastService.error(error)),
      ),
    { dispatch: false },
  );
}
