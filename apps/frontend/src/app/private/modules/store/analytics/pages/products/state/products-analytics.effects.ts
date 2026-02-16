import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, mergeMap, catchError, withLatestFrom, tap } from 'rxjs/operators';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import * as ProductsActions from './products-analytics.actions';
import {
  selectDateRange,
  selectSearch,
  selectPage,
  selectLimit,
  selectSortBy,
  selectSortOrder,
} from './products-analytics.selectors';
import { ProductsAnalyticsQueryDto } from '../../../interfaces/products-analytics.interface';

@Injectable()
export class ProductsAnalyticsEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);

  loadSummary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ProductsActions.loadProductsSummary),
      withLatestFrom(this.store.select(selectDateRange)),
      mergeMap(([, dateRange]) => {
        const query: ProductsAnalyticsQueryDto = { date_range: dateRange };
        return this.analyticsService.getProductsSummary(query).pipe(
          map((response) =>
            ProductsActions.loadProductsSummarySuccess({ summary: response.data }),
          ),
          catchError((error) =>
            of(ProductsActions.loadProductsSummaryFailure({
              error: error.error?.message || error.message || 'Error al cargar el resumen de productos',
            })),
          ),
        );
      }),
    ),
  );

  loadTopSellers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ProductsActions.loadTopSellers),
      withLatestFrom(this.store.select(selectDateRange)),
      mergeMap(([, dateRange]) => {
        const query: ProductsAnalyticsQueryDto = {
          date_range: dateRange,
          limit: 10,
        };
        return this.analyticsService.getTopSellingProducts(query).pipe(
          map((response) =>
            ProductsActions.loadTopSellersSuccess({ topSellers: response.data }),
          ),
          catchError((error) =>
            of(ProductsActions.loadTopSellersFailure({
              error: error.error?.message || error.message || 'Error al cargar los más vendidos',
            })),
          ),
        );
      }),
    ),
  );

  loadTable$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ProductsActions.loadProductsTable),
      withLatestFrom(
        this.store.select(selectDateRange),
        this.store.select(selectSearch),
        this.store.select(selectPage),
        this.store.select(selectLimit),
        this.store.select(selectSortBy),
        this.store.select(selectSortOrder),
      ),
      mergeMap(([, dateRange, search, page, limit, sortBy, sortOrder]) => {
        const query: ProductsAnalyticsQueryDto = {
          date_range: dateRange,
          ...(search && { search }),
          page,
          limit,
          sort_by: sortBy,
          sort_order: sortOrder,
        };
        return this.analyticsService.getProductsTable(query).pipe(
          map((response) =>
            ProductsActions.loadProductsTableSuccess({
              products: response.data,
              total: response.meta.pagination.total,
            }),
          ),
          catchError((error) =>
            of(ProductsActions.loadProductsTableFailure({
              error: error.error?.message || error.message || 'Error al cargar la tabla de productos',
            })),
          ),
        );
      }),
    ),
  );

  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ProductsActions.setDateRange),
      mergeMap(() => [
        ProductsActions.loadProductsSummary(),
        ProductsActions.loadTopSellers(),
        ProductsActions.loadProductsTable(),
      ]),
    ),
  );

  searchChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ProductsActions.setSearch),
      mergeMap(() => [ProductsActions.loadProductsTable()]),
    ),
  );

  pageChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ProductsActions.setPage),
      mergeMap(() => [ProductsActions.loadProductsTable()]),
    ),
  );

  sortChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ProductsActions.setSort),
      mergeMap(() => [ProductsActions.loadProductsTable()]),
    ),
  );

  exportReport$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ProductsActions.exportProductsReport),
      withLatestFrom(this.store.select(selectDateRange)),
      mergeMap(([, dateRange]) => {
        const query: ProductsAnalyticsQueryDto = { date_range: dateRange };
        return this.analyticsService.exportProductsAnalytics(query).pipe(
          tap((blob) => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `productos_${new Date().toISOString().split('T')[0]}.xlsx`;
            a.click();
            window.URL.revokeObjectURL(url);
            this.toastService.success('Reporte exportado correctamente');
          }),
          map(() => ProductsActions.exportProductsReportSuccess()),
          catchError((error) =>
            of(ProductsActions.exportProductsReportFailure({
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
          ProductsActions.loadProductsSummaryFailure,
          ProductsActions.loadTopSellersFailure,
          ProductsActions.loadProductsTableFailure,
          ProductsActions.exportProductsReportFailure,
        ),
        tap(({ error }) => this.toastService.error(error)),
      ),
    { dispatch: false },
  );
}
