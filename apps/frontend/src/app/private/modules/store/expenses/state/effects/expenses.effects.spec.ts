import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { Action } from '@ngrx/store';
import { Observable, Subject, of, throwError } from 'rxjs';

import { ExpensesEffects } from './expenses.effects';
import * as ExpensesActions from '../actions/expenses.actions';
import { initialExpensesState } from '../expenses.state';
import { ExpensesService } from '../../services/expenses.service';
import { ReportsDataService } from '../../../reports/services/reports-data.service';
import { AnalyticsService } from '../../../analytics/services/analytics.service';
import { AnalyticsRefreshService } from '../../../shared/services/analytics-refresh.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';

/** QUI-360 — avisos de éxito/error en mutaciones de gastos. */
describe('ExpensesEffects — toasts (QUI-360)', () => {
  let actions$: Subject<Action>;
  let effects: ExpensesEffects;
  let toast: jasmine.SpyObj<ToastService>;
  let service: jasmine.SpyObj<ExpensesService>;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning']);
    service = jasmine.createSpyObj('ExpensesService', ['approveExpense']);

    TestBed.configureTestingModule({
      providers: [
        ExpensesEffects,
        provideMockActions(() => actions$ as Observable<Action>),
        provideMockStore({ initialState: { expenses: initialExpensesState } }),
        { provide: ExpensesService, useValue: service },
        {
          provide: ReportsDataService,
          useValue: jasmine.createSpyObj('ReportsDataService', ['clearCache']),
        },
        {
          provide: AnalyticsService,
          useValue: jasmine.createSpyObj('AnalyticsService', ['invalidateCache']),
        },
        {
          provide: AnalyticsRefreshService,
          useValue: jasmine.createSpyObj('AnalyticsRefreshService', ['triggerRefresh']),
        },
        { provide: ToastService, useValue: toast },
      ],
    });
    effects = TestBed.inject(ExpensesEffects);
  });

  function runSuccessToast(action: Action): void {
    const sub = effects.mutationSuccessToast$.subscribe();
    actions$.next(action);
    sub.unsubscribe();
  }

  function runFailureToast(action: Action): void {
    const sub = effects.mutationFailureToast$.subscribe();
    actions$.next(action);
    sub.unsubscribe();
  }

  it('avisa éxito al aprobar', () => {
    runSuccessToast(ExpensesActions.approveExpenseSuccess({ expense: { id: 1 } as any }));
    expect(toast.success).toHaveBeenCalledOnceWith('Gasto aprobado');
  });

  it('avisa éxito al eliminar', () => {
    runSuccessToast(ExpensesActions.deleteExpenseSuccess({ id: 1 }));
    expect(toast.success).toHaveBeenCalledOnceWith('Gasto eliminado');
  });

  it('avisa éxito al crear categoría', () => {
    runSuccessToast(
      ExpensesActions.createExpenseCategorySuccess({ category: { id: 1 } as any }),
    );
    expect(toast.success).toHaveBeenCalledOnceWith('Categoría creada');
  });

  it('avisa error con el mensaje del Failure', () => {
    runFailureToast(ExpensesActions.payExpenseFailure({ error: 'Boom' }));
    expect(toast.error).toHaveBeenCalledOnceWith('Boom');
  });

  it('no avisa en createExpenseSuccess (lo hace el componente)', () => {
    runSuccessToast(ExpensesActions.createExpenseSuccess({ expense: { id: 1 } as any }));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('no avisa en createExpenseFailure (lo hace el componente)', () => {
    runFailureToast(ExpensesActions.createExpenseFailure({ error: 'X' }));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('approveExpense$ usa parseApiError en el catchError', () => {
    const httpError = { error: { message: 'X', error_code: 'SYS_INTERNAL_001' } };
    service.approveExpense.and.returnValue(throwError(() => httpError));
    const emitted: Action[] = [];
    const sub = effects.approveExpense$.subscribe((a) => emitted.push(a));
    actions$.next(ExpensesActions.approveExpense({ id: 1 }));
    sub.unsubscribe();

    expect(emitted).toEqual([
      ExpensesActions.approveExpenseFailure({
        error: parseApiError(httpError).userMessage,
      }),
    ]);
  });
});
