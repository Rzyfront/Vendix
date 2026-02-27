import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, mergeMap, catchError, withLatestFrom, tap } from 'rxjs/operators';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import * as CustomersActions from './customers-analytics.actions';
import { selectDateRange, selectGranularity } from './customers-analytics.selectors';
import { CustomersAnalyticsQueryDto } from '../../../interfaces/customers-analytics.interface';

@Injectable()
export class CustomersAnalyticsEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);

  loadSummary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CustomersActions.loadCustomersSummary),
      withLatestFrom(
        this.store.select(selectDateRange),
      ),
      mergeMap(([, dateRange]) => {
        const query: CustomersAnalyticsQueryDto = {
          date_range: dateRange,
        };
        return this.analyticsService.getCustomersSummary(query).pipe(
          map((response) =>
            CustomersActions.loadCustomersSummarySuccess({ summary: response.data }),
          ),
          catchError((error) =>
            of(CustomersActions.loadCustomersSummaryFailure({
              error: error.error?.message || error.message || 'Error al cargar el resumen de clientes',
            })),
          ),
        );
      }),
    ),
  );

  loadTrends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CustomersActions.loadCustomersTrends),
      withLatestFrom(
        this.store.select(selectDateRange),
        this.store.select(selectGranularity),
      ),
      mergeMap(([, dateRange, granularity]) => {
        const query: CustomersAnalyticsQueryDto = {
          date_range: dateRange,
          granularity: granularity as any,
        };
        return this.analyticsService.getCustomersTrends(query).pipe(
          map((response) =>
            CustomersActions.loadCustomersTrendsSuccess({ trends: response.data }),
          ),
          catchError((error) =>
            of(CustomersActions.loadCustomersTrendsFailure({
              error: error.error?.message || error.message || 'Error al cargar las tendencias de clientes',
            })),
          ),
        );
      }),
    ),
  );

  loadTopCustomers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CustomersActions.loadTopCustomers),
      withLatestFrom(
        this.store.select(selectDateRange),
      ),
      mergeMap(([, dateRange]) => {
        const query: CustomersAnalyticsQueryDto = {
          date_range: dateRange,
        };
        return this.analyticsService.getTopCustomers(query).pipe(
          map((response) =>
            CustomersActions.loadTopCustomersSuccess({ topCustomers: response.data }),
          ),
          catchError((error) =>
            of(CustomersActions.loadTopCustomersFailure({
              error: error.error?.message || error.message || 'Error al cargar los top clientes',
            })),
          ),
        );
      }),
    ),
  );

  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        CustomersActions.setDateRange,
        CustomersActions.setGranularity,
      ),
      mergeMap(() => [
        CustomersActions.loadCustomersSummary(),
        CustomersActions.loadCustomersTrends(),
        CustomersActions.loadTopCustomers(),
      ]),
    ),
  );

  exportReport$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CustomersActions.exportCustomersReport),
      withLatestFrom(
        this.store.select(selectDateRange),
      ),
      mergeMap(([, dateRange]) => {
        const query: CustomersAnalyticsQueryDto = {
          date_range: dateRange,
        };
        return this.analyticsService.exportCustomersAnalytics(query).pipe(
          tap((blob) => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `clientes_${new Date().toISOString().split('T')[0]}.xlsx`;
            a.click();
            window.URL.revokeObjectURL(url);
            this.toastService.success('Reporte de clientes exportado correctamente');
          }),
          map(() => CustomersActions.exportCustomersReportSuccess()),
          catchError((error) =>
            of(CustomersActions.exportCustomersReportFailure({
              error: error.error?.message || error.message || 'Error al exportar el reporte',
            })),
          ),
        );
      }),
    ),
  );

  showError$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          CustomersActions.loadCustomersSummaryFailure,
          CustomersActions.loadCustomersTrendsFailure,
          CustomersActions.loadTopCustomersFailure,
          CustomersActions.exportCustomersReportFailure,
        ),
        tap(({ error }) => this.toastService.error(error)),
      ),
    { dispatch: false },
  );
}
