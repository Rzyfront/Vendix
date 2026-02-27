import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, mergeMap, catchError, withLatestFrom, tap } from 'rxjs/operators';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import * as OverviewActions from './overview-summary.actions';
import { selectDateRange, selectGranularity } from './overview-summary.selectors';
import { OverviewAnalyticsQueryDto } from '../../../interfaces/overview-analytics.interface';

@Injectable()
export class OverviewSummaryEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);

  loadSummary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(OverviewActions.loadOverviewSummary),
      withLatestFrom(this.store.select(selectDateRange)),
      mergeMap(([, dateRange]) => {
        const query: OverviewAnalyticsQueryDto = {
          date_range: dateRange,
        };
        return this.analyticsService.getOverviewSummary(query).pipe(
          map((response) =>
            OverviewActions.loadOverviewSummarySuccess({ summary: response.data }),
          ),
          catchError((error) =>
            of(OverviewActions.loadOverviewSummaryFailure({
              error: error.error?.message || error.message || 'Error al cargar el resumen general',
            })),
          ),
        );
      }),
    ),
  );

  loadTrends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(OverviewActions.loadOverviewTrends),
      withLatestFrom(
        this.store.select(selectDateRange),
        this.store.select(selectGranularity),
      ),
      mergeMap(([, dateRange, granularity]) => {
        const query: OverviewAnalyticsQueryDto = {
          date_range: dateRange,
          granularity: granularity as any,
        };
        return this.analyticsService.getOverviewTrends(query).pipe(
          map((response) =>
            OverviewActions.loadOverviewTrendsSuccess({ trends: response.data }),
          ),
          catchError((error) =>
            of(OverviewActions.loadOverviewTrendsFailure({
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
        OverviewActions.setDateRange,
        OverviewActions.setGranularity,
      ),
      mergeMap(() => [
        OverviewActions.loadOverviewSummary(),
        OverviewActions.loadOverviewTrends(),
      ]),
    ),
  );

  showError$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          OverviewActions.loadOverviewSummaryFailure,
          OverviewActions.loadOverviewTrendsFailure,
        ),
        tap(({ error }) => this.toastService.error(error)),
      ),
    { dispatch: false },
  );
}
