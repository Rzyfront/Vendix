import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, mergeMap, catchError, withLatestFrom, tap } from 'rxjs/operators';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import * as SalesActions from './sales-summary.actions';
import { selectDateRange, selectGranularity, selectChannel } from './sales-summary.selectors';
import { SalesAnalyticsQueryDto } from '../../../interfaces/sales-analytics.interface';

@Injectable()
export class SalesSummaryEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);

  loadSummary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SalesActions.loadSalesSummary),
      withLatestFrom(
        this.store.select(selectDateRange),
        this.store.select(selectChannel),
      ),
      mergeMap(([, dateRange, channel]) => {
        const query: SalesAnalyticsQueryDto = {
          date_range: dateRange,
          ...(channel && { channel }),
        };
        return this.analyticsService.getSalesSummary(query).pipe(
          map((response) =>
            SalesActions.loadSalesSummarySuccess({ summary: response.data }),
          ),
          catchError((error) =>
            of(SalesActions.loadSalesSummaryFailure({
              error: error.error?.message || error.message || 'Error al cargar el resumen de ventas',
            })),
          ),
        );
      }),
    ),
  );

  loadTrends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SalesActions.loadSalesTrends),
      withLatestFrom(
        this.store.select(selectDateRange),
        this.store.select(selectGranularity),
        this.store.select(selectChannel),
      ),
      mergeMap(([, dateRange, granularity, channel]) => {
        const query: SalesAnalyticsQueryDto = {
          date_range: dateRange,
          granularity: granularity as any,
          ...(channel && { channel }),
        };
        return this.analyticsService.getSalesTrends(query).pipe(
          map((response) =>
            SalesActions.loadSalesTrendsSuccess({ trends: response.data }),
          ),
          catchError((error) =>
            of(SalesActions.loadSalesTrendsFailure({
              error: error.error?.message || error.message || 'Error al cargar las tendencias',
            })),
          ),
        );
      }),
    ),
  );

  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        SalesActions.setDateRange,
        SalesActions.setGranularity,
        SalesActions.setChannel,
      ),
      mergeMap(() => [
        SalesActions.loadSalesSummary(),
        SalesActions.loadSalesTrends(),
      ]),
    ),
  );

  exportReport$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SalesActions.exportSalesReport),
      withLatestFrom(
        this.store.select(selectDateRange),
        this.store.select(selectChannel),
      ),
      mergeMap(([, dateRange, channel]) => {
        const query: SalesAnalyticsQueryDto = {
          date_range: dateRange,
          ...(channel && { channel }),
        };
        return this.analyticsService.exportSalesAnalytics(query).pipe(
          tap((blob) => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ventas_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
            this.toastService.success('Reporte exportado correctamente');
          }),
          map(() => SalesActions.exportSalesReportSuccess()),
          catchError((error) =>
            of(SalesActions.exportSalesReportFailure({
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
          SalesActions.loadSalesSummaryFailure,
          SalesActions.loadSalesTrendsFailure,
          SalesActions.exportSalesReportFailure,
        ),
        tap(({ error }) => this.toastService.error(error)),
      ),
    { dispatch: false },
  );
}
