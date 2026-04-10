import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, switchMap, exhaustMap, catchError, withLatestFrom, tap } from 'rxjs/operators';
import { PayrollService } from '../../services/payroll.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import * as PayrollActions from '../actions/payroll.actions';
import { selectPayrollState } from '../selectors/payroll.selectors';

@Injectable()
export class PayrollEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);

  // ─── Employees ────────────────────────────────────────────

  loadEmployees$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.loadEmployees),
      withLatestFrom(this.store.select(selectPayrollState)),
      switchMap(([, state]) =>
        this.payrollService.getEmployees({
          page: state.employeePage,
          limit: state.employeeLimit,
          search: state.employeeSearch || undefined,
          sort_by: state.employeeSortBy,
          sort_order: state.employeeSortOrder,
          status: state.employeeStatusFilter || undefined,
          department: state.employeeDepartmentFilter || undefined,
        }).pipe(
          map((response) =>
            PayrollActions.loadEmployeesSuccess({ employees: response.data, meta: response.meta })
          ),
          catchError((error) =>
            of(PayrollActions.loadEmployeesFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  employeeFilterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PayrollActions.setEmployeeSearch,
        PayrollActions.setEmployeePage,
        PayrollActions.setEmployeeSort,
        PayrollActions.setEmployeeStatusFilter,
        PayrollActions.setEmployeeDepartmentFilter,
        PayrollActions.clearEmployeeFilters,
      ),
      map(() => PayrollActions.loadEmployees())
    )
  );

  loadEmployee$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.loadEmployee),
      switchMap(({ id }) =>
        this.payrollService.getEmployee(id).pipe(
          map((response) =>
            PayrollActions.loadEmployeeSuccess({ employee: response.data })
          ),
          catchError((error) =>
            of(PayrollActions.loadEmployeeFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  createEmployee$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.createEmployee),
      switchMap(({ employee }) =>
        this.payrollService.createEmployee(employee).pipe(
          map((response) =>
            PayrollActions.createEmployeeSuccess({ employee: response.data })
          ),
          catchError((error) =>
            of(PayrollActions.createEmployeeFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  updateEmployee$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.updateEmployee),
      switchMap(({ id, employee }) =>
        this.payrollService.updateEmployee(id, employee).pipe(
          map((response) =>
            PayrollActions.updateEmployeeSuccess({ employee: response.data })
          ),
          catchError((error) =>
            of(PayrollActions.updateEmployeeFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  terminateEmployee$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.terminateEmployee),
      switchMap(({ id }) =>
        this.payrollService.terminateEmployee(id).pipe(
          map((response) =>
            PayrollActions.terminateEmployeeSuccess({ employee: response.data })
          ),
          catchError((error) =>
            of(PayrollActions.terminateEmployeeFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  employeeMutationSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PayrollActions.createEmployeeSuccess,
        PayrollActions.updateEmployeeSuccess,
        PayrollActions.terminateEmployeeSuccess,
      ),
      switchMap(() => [
        PayrollActions.loadEmployees(),
        PayrollActions.loadEmployeeStats(),
      ])
    )
  );

  loadEmployeeStats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.loadEmployeeStats),
      exhaustMap(() =>
        this.payrollService.getEmployeeStats().pipe(
          map((response) =>
            PayrollActions.loadEmployeeStatsSuccess({ stats: response.data })
          ),
          catchError((error) =>
            of(PayrollActions.loadEmployeeStatsFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  // ─── Payroll Runs ───────────────────────────────────────

  loadPayrollRuns$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.loadPayrollRuns),
      withLatestFrom(this.store.select(selectPayrollState)),
      switchMap(([, state]) =>
        this.payrollService.getPayrollRuns({
          page: state.payrollRunPage,
          limit: state.payrollRunLimit,
          search: state.payrollRunSearch || undefined,
          sort_by: state.payrollRunSortBy,
          sort_order: state.payrollRunSortOrder,
          status: state.payrollRunStatusFilter || undefined,
          frequency: state.payrollRunFrequencyFilter || undefined,
          date_from: state.payrollRunDateFrom || undefined,
          date_to: state.payrollRunDateTo || undefined,
        }).pipe(
          map((response) =>
            PayrollActions.loadPayrollRunsSuccess({ payrollRuns: response.data, meta: response.meta })
          ),
          catchError((error) =>
            of(PayrollActions.loadPayrollRunsFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  payrollRunFilterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PayrollActions.setPayrollRunSearch,
        PayrollActions.setPayrollRunPage,
        PayrollActions.setPayrollRunSort,
        PayrollActions.setPayrollRunStatusFilter,
        PayrollActions.setPayrollRunFrequencyFilter,
        PayrollActions.setPayrollRunDateRange,
        PayrollActions.clearPayrollRunFilters,
      ),
      map(() => PayrollActions.loadPayrollRuns())
    )
  );

  loadPayrollRun$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.loadPayrollRun),
      switchMap(({ id }) =>
        this.payrollService.getPayrollRun(id).pipe(
          map((response) =>
            PayrollActions.loadPayrollRunSuccess({ payrollRun: response.data })
          ),
          catchError((error) =>
            of(PayrollActions.loadPayrollRunFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  createPayrollRun$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.createPayrollRun),
      switchMap(({ payrollRun }) =>
        this.payrollService.createPayrollRun(payrollRun).pipe(
          map((response) =>
            PayrollActions.createPayrollRunSuccess({ payrollRun: response.data })
          ),
          catchError((error) =>
            of(PayrollActions.createPayrollRunFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  calculatePayrollRun$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.calculatePayrollRun),
      switchMap(({ id }) =>
        this.payrollService.calculatePayrollRun(id).pipe(
          map((response) => PayrollActions.calculatePayrollRunSuccess({ payrollRun: response.data })),
          catchError((error) =>
            of(PayrollActions.calculatePayrollRunFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  approvePayrollRun$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.approvePayrollRun),
      switchMap(({ id }) =>
        this.payrollService.approvePayrollRun(id).pipe(
          map((response) => PayrollActions.approvePayrollRunSuccess({ payrollRun: response.data })),
          catchError((error) =>
            of(PayrollActions.approvePayrollRunFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  sendPayrollRun$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.sendPayrollRun),
      switchMap(({ id }) =>
        this.payrollService.sendPayrollRun(id).pipe(
          map((response) => PayrollActions.sendPayrollRunSuccess({ payrollRun: response.data })),
          catchError((error) =>
            of(PayrollActions.sendPayrollRunFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  payPayrollRun$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.payPayrollRun),
      switchMap(({ id }) =>
        this.payrollService.payPayrollRun(id).pipe(
          map((response) => PayrollActions.payPayrollRunSuccess({ payrollRun: response.data })),
          catchError((error) =>
            of(PayrollActions.payPayrollRunFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  cancelPayrollRun$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.cancelPayrollRun),
      switchMap(({ id }) =>
        this.payrollService.cancelPayrollRun(id).pipe(
          map((response) => PayrollActions.cancelPayrollRunSuccess({ payrollRun: response.data })),
          catchError((error) =>
            of(PayrollActions.cancelPayrollRunFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );

  payrollRunMutationSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PayrollActions.createPayrollRunSuccess,
        PayrollActions.calculatePayrollRunSuccess,
        PayrollActions.approvePayrollRunSuccess,
        PayrollActions.sendPayrollRunSuccess,
        PayrollActions.payPayrollRunSuccess,
        PayrollActions.cancelPayrollRunSuccess,
      ),
      switchMap(() => [
        PayrollActions.loadPayrollRuns(),
        PayrollActions.loadPayrollRunStats(),
      ])
    )
  );

  // ─── Toast Notifications ─────────────────────────────────

  payrollRunSuccessToast$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PayrollActions.calculatePayrollRunSuccess,
        PayrollActions.approvePayrollRunSuccess,
        PayrollActions.sendPayrollRunSuccess,
        PayrollActions.payPayrollRunSuccess,
        PayrollActions.cancelPayrollRunSuccess,
      ),
      tap((action) => {
        const messages: Record<string, string> = {
          '[Payroll] Calculate Payroll Run Success': 'Nómina calculada exitosamente',
          '[Payroll] Approve Payroll Run Success': 'Nómina aprobada exitosamente',
          '[Payroll] Send Payroll Run Success': 'Nómina enviada exitosamente',
          '[Payroll] Pay Payroll Run Success': 'Nómina marcada como pagada',
          '[Payroll] Cancel Payroll Run Success': 'Nómina cancelada',
        };
        this.toastService.success(messages[action.type] || 'Operación exitosa');
      }),
    ), { dispatch: false }
  );

  payrollRunFailureToast$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PayrollActions.calculatePayrollRunFailure,
        PayrollActions.approvePayrollRunFailure,
        PayrollActions.sendPayrollRunFailure,
        PayrollActions.payPayrollRunFailure,
        PayrollActions.cancelPayrollRunFailure,
        PayrollActions.createPayrollRunFailure,
      ),
      tap(({ error }) => this.toastService.error(error)),
    ), { dispatch: false }
  );

  employeeSuccessToast$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PayrollActions.createEmployeeSuccess,
        PayrollActions.updateEmployeeSuccess,
        PayrollActions.terminateEmployeeSuccess,
      ),
      tap((action) => {
        const messages: Record<string, string> = {
          '[Payroll] Create Employee Success': 'Empleado creado exitosamente',
          '[Payroll] Update Employee Success': 'Empleado actualizado exitosamente',
          '[Payroll] Terminate Employee Success': 'Empleado desvinculado exitosamente',
        };
        this.toastService.success(messages[action.type] || 'Operación exitosa');
      }),
    ), { dispatch: false }
  );

  employeeFailureToast$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PayrollActions.createEmployeeFailure,
        PayrollActions.updateEmployeeFailure,
        PayrollActions.terminateEmployeeFailure,
      ),
      tap(({ error }) => this.toastService.error(error)),
    ), { dispatch: false }
  );

  loadPayrollRunStats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.loadPayrollRunStats),
      exhaustMap(() =>
        this.payrollService.getPayrollRunStats().pipe(
          map((response) =>
            PayrollActions.loadPayrollRunStatsSuccess({ stats: response.data })
          ),
          catchError((error) =>
            of(PayrollActions.loadPayrollRunStatsFailure({
              error: parseApiError(error).userMessage
            }))
          )
        )
      )
    )
  );
}
