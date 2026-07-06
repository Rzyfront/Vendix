import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of, timer, merge } from 'rxjs';
import {
  map,
  switchMap,
  exhaustMap,
  mergeMap,
  catchError,
  withLatestFrom,
  tap,
  takeUntil,
  takeWhile,
} from 'rxjs/operators';
import { PayrollService } from '../../services/payroll.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import * as PayrollActions from '../actions/payroll.actions';
import { selectPayrollState } from '../selectors/payroll.selectors';
import { DianStatusValue } from '../../interfaces/payroll.interface';

@Injectable()
export class PayrollEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);

  /** DIAN status poll cadence and hard deadline (overridable per dispatch). */
  private readonly DIAN_POLL_INTERVAL_MS = 5000;
  private readonly DIAN_POLL_TIMEOUT_MS = 120000;
  private readonly DIAN_TERMINAL_STATES: ReadonlyArray<DianStatusValue> = [
    'accepted',
    'rejected',
    'error',
  ];

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
          catchError((error) => {
            const parsed = parseApiError(error);
            return of(PayrollActions.createEmployeeFailure({
              error: parsed.userMessage,
              errorCode: parsed.errorCode ?? undefined,
              existingEmployee: parsed.details?.existing_employee ?? undefined,
              pendingDto: employee,
            }));
          })
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
      tap((action: any) => {
        if (action.errorCode === 'PAYROLL_ASSOCIATE_CONFIRM_001') {
          return;
        }
        this.toastService.error(action.error);
      }),
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

  // ─── DIAN: Send Electronic Payroll ───────────────────────

  sendToDian$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.sendToDian),
      // exhaustMap: ignore duplicate clicks while a transmission is in flight.
      exhaustMap(({ runId }) =>
        this.payrollService.sendToDian(runId).pipe(
          map((response) =>
            PayrollActions.sendToDianSuccess({ runId, result: response.data })
          ),
          catchError((error) =>
            of(PayrollActions.sendToDianFailure({
              runId,
              error: parseApiError(error).userMessage,
            }))
          )
        )
      )
    )
  );

  // ─── DIAN: Status Polling ────────────────────────────────
  // Polls GET dian-status on a fixed cadence until the document reaches a
  // terminal state (accepted / rejected / error), a hard timeout elapses, or
  // the loop is explicitly cancelled. Mirrors the repo polling idiom in
  // subscription.effects.ts: switchMap owns cancellation of a prior loop, and
  // the terminal/timeout actions round-trip through the store to tear down the
  // merged timer streams.
  dianStatusPolling$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.loadDianStatus),
      switchMap(({ runId, intervalMs, timeoutMs }) => {
        const period =
          intervalMs && intervalMs > 0 ? intervalMs : this.DIAN_POLL_INTERVAL_MS;
        const deadline =
          timeoutMs && timeoutMs > 0 ? timeoutMs : this.DIAN_POLL_TIMEOUT_MS;

        const cancel$ = this.actions$.pipe(
          ofType(
            PayrollActions.stopDianStatusPolling,
            PayrollActions.sendToDian,
            PayrollActions.loadDianStatusSuccess,
            PayrollActions.loadDianStatusFailure,
            PayrollActions.dianStatusPollingTimeout,
            PayrollActions.clearPayrollState,
          ),
        );

        const timeout$ = timer(deadline).pipe(
          map(() => PayrollActions.dianStatusPollingTimeout({ runId })),
        );

        const poll$ = timer(0, period).pipe(
          // exhaustMap: never overlap requests if a poll runs long.
          exhaustMap(() =>
            this.payrollService.getDianStatus(runId).pipe(
              map((response) => {
                const view = response.data;
                const status = view?.dian_status?.status;
                const terminal =
                  !!status && this.DIAN_TERMINAL_STATES.includes(status);
                return terminal
                  ? PayrollActions.loadDianStatusSuccess({ runId, status: view })
                  : PayrollActions.dianStatusResult({ runId, status: view });
              }),
              catchError((error) =>
                of(PayrollActions.loadDianStatusFailure({
                  runId,
                  error: parseApiError(error).userMessage,
                }))
              )
            )
          ),
          // Emit intermediate ticks, then emit the terminal action (inclusive)
          // and complete the polling stream.
          takeWhile(
            (action) => action.type === PayrollActions.dianStatusResult.type,
            true,
          ),
        );

        return merge(poll$, timeout$).pipe(takeUntil(cancel$));
      })
    )
  );

  // ─── DIAN: Adjustment Note (per-item) ────────────────────

  sendAdjustment$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.sendAdjustment),
      // mergeMap: adjustments for distinct items may run concurrently; the
      // reducer tracks loading per itemId.
      mergeMap(({ runId, itemId, payload }) =>
        this.payrollService.sendAdjustment(runId, itemId, payload).pipe(
          map((response) =>
            PayrollActions.sendAdjustmentSuccess({
              runId,
              itemId,
              result: response.data,
            })
          ),
          catchError((error) =>
            of(PayrollActions.sendAdjustmentFailure({
              runId,
              itemId,
              error: parseApiError(error).userMessage,
            }))
          )
        )
      )
    )
  );

  // ─── Bank Export ─────────────────────────────────────────

  loadAvailableBanks$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.loadAvailableBanks),
      exhaustMap(() =>
        this.payrollService.getAvailableBanks().pipe(
          map((response) =>
            PayrollActions.loadAvailableBanksSuccess({ banks: response.data })
          ),
          catchError((error) =>
            of(PayrollActions.loadAvailableBanksFailure({
              error: parseApiError(error).userMessage,
            }))
          )
        )
      )
    )
  );

  validateBankData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.validateBankData),
      switchMap(({ runId }) =>
        this.payrollService.validateBankData(runId).pipe(
          map((response) =>
            PayrollActions.validateBankDataSuccess({ result: response.data })
          ),
          catchError((error) =>
            of(PayrollActions.validateBankDataFailure({
              error: parseApiError(error).userMessage,
            }))
          )
        )
      )
    )
  );

  exportAch$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.exportAch),
      exhaustMap(({ runId, payload }) =>
        this.payrollService.exportAch(runId, payload).pipe(
          map((response) =>
            PayrollActions.exportAchSuccess({ result: response.data })
          ),
          catchError((error) =>
            of(PayrollActions.exportAchFailure({
              error: parseApiError(error).userMessage,
            }))
          )
        )
      )
    )
  );

  // ─── DIAN / Bank: Post-success refresh ───────────────────

  // A DIAN transmission or adjustment changes run status → reload the run
  // detail (properly mapped), the list, and the stats.
  dianMutationSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PayrollActions.sendToDianSuccess,
        PayrollActions.sendAdjustmentSuccess,
      ),
      switchMap(({ runId }) => [
        PayrollActions.loadPayrollRun({ id: runId }),
        PayrollActions.loadPayrollRuns(),
        PayrollActions.loadPayrollRunStats(),
      ])
    )
  );

  // When polling resolves to a terminal DIAN status, refresh the run detail so
  // the open view reflects accepted/rejected.
  reloadRunAfterDianStatus$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PayrollActions.loadDianStatusSuccess),
      map(({ runId }) => PayrollActions.loadPayrollRun({ id: runId }))
    )
  );

  // ─── DIAN / Bank: Toasts ─────────────────────────────────

  dianSuccessToast$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PayrollActions.sendToDianSuccess,
        PayrollActions.sendAdjustmentSuccess,
        PayrollActions.exportAchSuccess,
      ),
      tap((action) => {
        const messages: Record<string, string> = {
          '[Payroll] Send To DIAN Success': 'Nómina enviada a la DIAN',
          '[Payroll] Send Adjustment Success': 'Nota de ajuste enviada a la DIAN',
          '[Payroll] Export ACH Success': 'Archivo bancario (ACH) generado',
        };
        this.toastService.success(messages[action.type] || 'Operación exitosa');
      }),
    ), { dispatch: false }
  );

  dianFailureToast$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PayrollActions.sendToDianFailure,
        PayrollActions.loadDianStatusFailure,
        PayrollActions.sendAdjustmentFailure,
        PayrollActions.validateBankDataFailure,
        PayrollActions.exportAchFailure,
        PayrollActions.loadAvailableBanksFailure,
      ),
      tap(({ error }) => this.toastService.error(error)),
    ), { dispatch: false }
  );
}
