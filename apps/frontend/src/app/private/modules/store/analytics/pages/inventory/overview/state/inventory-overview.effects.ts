import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, mergeMap, catchError, withLatestFrom, tap } from 'rxjs/operators';
import { AnalyticsService } from '../../../../services/analytics.service';
import { ToastService } from '../../../../../../../../shared/components/toast/toast.service';
import * as InventoryActions from './inventory-overview.actions';
import {
  selectDateRange,
  selectGranularity,
  selectLocationId,
} from './inventory-overview.selectors';
import { InventoryAnalyticsQueryDto } from '../../../../interfaces/inventory-analytics.interface';

@Injectable()
export class InventoryOverviewEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);

  loadSummary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InventoryActions.loadInventorySummary),
      withLatestFrom(
        this.store.select(selectLocationId),
      ),
      mergeMap(([, locationId]) => {
        const query: InventoryAnalyticsQueryDto = {
          ...(locationId && { location_id: locationId }),
        };
        return this.analyticsService.getInventorySummary(query).pipe(
          map((response) =>
            InventoryActions.loadInventorySummarySuccess({ summary: response.data }),
          ),
          catchError((error) =>
            of(InventoryActions.loadInventorySummaryFailure({
              error: error.error?.message || error.message || 'Error al cargar el resumen de inventario',
            })),
          ),
        );
      }),
    ),
  );

  loadMovementTrends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InventoryActions.loadMovementTrends),
      withLatestFrom(
        this.store.select(selectDateRange),
        this.store.select(selectGranularity),
        this.store.select(selectLocationId),
      ),
      mergeMap(([, dateRange, granularity, locationId]) => {
        const query: InventoryAnalyticsQueryDto = {
          date_range: dateRange,
          granularity: granularity as any,
          ...(locationId && { location_id: locationId }),
        };
        return this.analyticsService.getMovementTrends(query).pipe(
          map((response) =>
            InventoryActions.loadMovementTrendsSuccess({ trends: response.data }),
          ),
          catchError((error) =>
            of(InventoryActions.loadMovementTrendsFailure({
              error: error.error?.message || error.message || 'Error al cargar tendencias de movimientos',
            })),
          ),
        );
      }),
    ),
  );

  loadMovementSummary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InventoryActions.loadMovementSummary),
      withLatestFrom(
        this.store.select(selectDateRange),
        this.store.select(selectLocationId),
      ),
      mergeMap(([, dateRange, locationId]) => {
        const query: InventoryAnalyticsQueryDto = {
          date_range: dateRange,
          ...(locationId && { location_id: locationId }),
        };
        return this.analyticsService.getMovementSummary(query).pipe(
          map((response) =>
            InventoryActions.loadMovementSummarySuccess({ movementSummary: response.data }),
          ),
          catchError((error) =>
            of(InventoryActions.loadMovementSummaryFailure({
              error: error.error?.message || error.message || 'Error al cargar resumen de movimientos',
            })),
          ),
        );
      }),
    ),
  );

  loadValuations$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InventoryActions.loadValuations),
      withLatestFrom(
        this.store.select(selectLocationId),
      ),
      mergeMap(([, locationId]) => {
        const query: InventoryAnalyticsQueryDto = {
          ...(locationId && { location_id: locationId }),
        };
        return this.analyticsService.getInventoryValuation(query).pipe(
          map((response) =>
            InventoryActions.loadValuationsSuccess({ valuations: response.data }),
          ),
          catchError((error) =>
            of(InventoryActions.loadValuationsFailure({
              error: error.error?.message || error.message || 'Error al cargar valorización',
            })),
          ),
        );
      }),
    ),
  );

  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        InventoryActions.setDateRange,
        InventoryActions.setGranularity,
        InventoryActions.setLocationId,
      ),
      mergeMap(() => [
        InventoryActions.loadInventorySummary(),
        InventoryActions.loadMovementTrends(),
        InventoryActions.loadMovementSummary(),
        InventoryActions.loadValuations(),
      ]),
    ),
  );

  exportReport$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InventoryActions.exportInventoryReport),
      withLatestFrom(
        this.store.select(selectDateRange),
        this.store.select(selectLocationId),
      ),
      mergeMap(([, dateRange, locationId]) => {
        const query: InventoryAnalyticsQueryDto = {
          date_range: dateRange,
          ...(locationId && { location_id: locationId }),
        };
        return this.analyticsService.exportInventoryAnalytics(query).pipe(
          tap((blob) => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `inventario_${new Date().toISOString().split('T')[0]}.xlsx`;
            a.click();
            window.URL.revokeObjectURL(url);
            this.toastService.success('Reporte exportado correctamente');
          }),
          map(() => InventoryActions.exportInventoryReportSuccess()),
          catchError((error) =>
            of(InventoryActions.exportInventoryReportFailure({
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
          InventoryActions.loadInventorySummaryFailure,
          InventoryActions.loadMovementTrendsFailure,
          InventoryActions.loadMovementSummaryFailure,
          InventoryActions.loadValuationsFailure,
          InventoryActions.exportInventoryReportFailure,
        ),
        tap(({ error }) => this.toastService.error(error)),
      ),
    { dispatch: false },
  );
}
