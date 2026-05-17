import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, mergeMap, catchError, withLatestFrom, tap } from 'rxjs/operators';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import * as AbandonedCartsActions from './abandoned-carts-analytics.actions';
import { selectDateRange, selectGranularity } from './abandoned-carts-analytics.selectors';
import { AbandonedCartsAnalyticsQueryDto } from '../../../interfaces/abandoned-carts-analytics.interface';

@Injectable()
export class AbandonedCartsAnalyticsEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);

  loadSummary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AbandonedCartsActions.loadAbandonedCartsSummary),
      withLatestFrom(
        this.store.select(selectDateRange),
      ),
      mergeMap(([, dateRange]) => {
        const query: AbandonedCartsAnalyticsQueryDto = {
          date_range: dateRange,
        };
        return this.analyticsService.getAbandonedCartsSummary(query).pipe(
          map((response) =>
            AbandonedCartsActions.loadAbandonedCartsSummarySuccess({ summary: response.data }),
          ),
          catchError((error) =>
            of(AbandonedCartsActions.loadAbandonedCartsSummaryFailure({
              error: error.error?.message || error.message || 'Error al cargar el resumen de carritos abandonados',
            })),
          ),
        );
      }),
    ),
  );

  loadTrends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AbandonedCartsActions.loadAbandonedCartsTrends),
      withLatestFrom(
        this.store.select(selectDateRange),
        this.store.select(selectGranularity),
      ),
      mergeMap(([, dateRange, granularity]) => {
        const query: AbandonedCartsAnalyticsQueryDto = {
          date_range: dateRange,
          granularity: granularity as any,
        };
        return this.analyticsService.getAbandonedCartsTrends(query).pipe(
          map((response) =>
            AbandonedCartsActions.loadAbandonedCartsTrendsSuccess({ trends: response.data }),
          ),
          catchError((error) =>
            of(AbandonedCartsActions.loadAbandonedCartsTrendsFailure({
              error: error.error?.message || error.message || 'Error al cargar las tendencias de carritos abandonados',
            })),
          ),
        );
      }),
    ),
  );

  loadByReason$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AbandonedCartsActions.loadAbandonedCartsByReason),
      withLatestFrom(
        this.store.select(selectDateRange),
      ),
      mergeMap(([, dateRange]) => {
        const query: AbandonedCartsAnalyticsQueryDto = {
          date_range: dateRange,
        };
        return this.analyticsService.getAbandonedCartsByReason(query).pipe(
          map((response) =>
            AbandonedCartsActions.loadAbandonedCartsByReasonSuccess({ byReason: response.data }),
          ),
          catchError((error) =>
            of(AbandonedCartsActions.loadAbandonedCartsByReasonFailure({
              error: error.error?.message || error.message || 'Error al cargar razones de abandono',
            })),
          ),
        );
      }),
    ),
  );

  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        AbandonedCartsActions.setDateRange,
        AbandonedCartsActions.setGranularity,
      ),
      mergeMap(() => [
        AbandonedCartsActions.loadAbandonedCartsSummary(),
        AbandonedCartsActions.loadAbandonedCartsTrends(),
        AbandonedCartsActions.loadAbandonedCartsByReason(),
      ]),
    ),
  );

  exportReport$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AbandonedCartsActions.exportAbandonedCartsReport),
      withLatestFrom(
        this.store.select(selectDateRange),
      ),
      mergeMap(([, dateRange]) => {
        const query: AbandonedCartsAnalyticsQueryDto = {
          date_range: dateRange,
        };
        return this.analyticsService.exportAbandonedCartsAnalytics(query).pipe(
          tap((blob) => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `carritos_abandonados_${new Date().toISOString().split('T')[0]}.xlsx`;
            a.click();
            window.URL.revokeObjectURL(url);
            this.toastService.success('Reporte de carritos abandonados exportado correctamente');
          }),
          map(() => AbandonedCartsActions.exportAbandonedCartsReportSuccess()),
          catchError((error) =>
            of(AbandonedCartsActions.exportAbandonedCartsReportFailure({
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
          AbandonedCartsActions.loadAbandonedCartsSummaryFailure,
          AbandonedCartsActions.loadAbandonedCartsTrendsFailure,
          AbandonedCartsActions.loadAbandonedCartsByReasonFailure,
          AbandonedCartsActions.exportAbandonedCartsReportFailure,
        ),
        tap(({ error }) => this.toastService.error(error)),
      ),
    { dispatch: false },
  );
}
