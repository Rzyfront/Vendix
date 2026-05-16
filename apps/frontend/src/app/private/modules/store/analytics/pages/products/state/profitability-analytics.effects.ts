import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, mergeMap, catchError, withLatestFrom, tap } from 'rxjs/operators';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import * as ProfitabilityActions from './profitability-analytics.actions';
import {
  selectProfitabilityDateRange,
  selectProfitabilityGranularity,
} from './profitability-analytics.selectors';
import { ProductsAnalyticsQueryDto } from '../../../interfaces/products-analytics.interface';

@Injectable()
export class ProfitabilityAnalyticsEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);

  loadProfitability$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ProfitabilityActions.loadProfitability),
      withLatestFrom(this.store.select(selectProfitabilityDateRange)),
      mergeMap(([, dateRange]) => {
        const query: ProductsAnalyticsQueryDto = { date_range: dateRange };
        return this.analyticsService.getProductProfitability(query).pipe(
          map((response) =>
            ProfitabilityActions.loadProfitabilitySuccess({
              products: response.data.products,
              summary: response.data.summary,
            }),
          ),
          catchError((error) =>
            of(
              ProfitabilityActions.loadProfitabilityFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error al cargar rentabilidad de productos',
              }),
            ),
          ),
        );
      }),
    ),
  );

  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        ProfitabilityActions.setProfitabilityDateRange,
        ProfitabilityActions.setProfitabilityGranularity,
      ),
      mergeMap(() => [ProfitabilityActions.loadProfitability()]),
    ),
  );

  exportReport$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ProfitabilityActions.exportProfitabilityReport),
      withLatestFrom(this.store.select(selectProfitabilityDateRange)),
      mergeMap(([, dateRange]) => {
        const query: ProductsAnalyticsQueryDto = { date_range: dateRange };
        return this.analyticsService.exportProductProfitability(query).pipe(
          tap((blob) => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `rentabilidad_productos_${new Date().toISOString().split('T')[0]}.xlsx`;
            a.click();
            window.URL.revokeObjectURL(url);
            this.toastService.success('Reporte exportado correctamente');
          }),
          map(() => ProfitabilityActions.exportProfitabilityReportSuccess()),
          catchError((error) =>
            of(
              ProfitabilityActions.exportProfitabilityReportFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error al exportar el reporte',
              }),
            ),
          ),
        );
      }),
    ),
  );

  showError$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          ProfitabilityActions.loadProfitabilityFailure,
          ProfitabilityActions.exportProfitabilityReportFailure,
        ),
        tap(({ error }) => this.toastService.error(error)),
      ),
    { dispatch: false },
  );
}
