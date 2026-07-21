import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of, EMPTY } from 'rxjs';
import { map, mergeMap, catchError, tap, withLatestFrom } from 'rxjs/operators';
import { ReportsActions } from './reports.actions';
import { selectSelectedReport, selectDateRange, selectFiscalPeriodId, selectCurrentPage, selectItemsPerPage } from './reports.selectors';
import { ReportsDataService } from '../services/reports-data.service';
import { ReportExportService } from '../services/report-export.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

@Injectable()
export class ReportsEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private reportsDataService = inject(ReportsDataService);
  private reportExportService = inject(ReportExportService);
  private toastService = inject(ToastService);

  selectReportAndLoad$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReportsActions.selectReport),
      map(() => ReportsActions.loadReportData()),
    ),
  );

  reloadOnFilterChange$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReportsActions.setDateRange, ReportsActions.setFiscalPeriod),
      map(() => ReportsActions.loadReportData()),
    ),
  );

  loadReportData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReportsActions.loadReportData),
      withLatestFrom(
        this.store.select(selectSelectedReport),
        this.store.select(selectDateRange),
        this.store.select(selectFiscalPeriodId),
        this.store.select(selectCurrentPage),
        this.store.select(selectItemsPerPage),
      ),
      mergeMap(([, report, dateRange, fiscalPeriodId, currentPage, itemsPerPage]) => {
        if (!report) {
          // No report selected yet — shell may have set date range before child
          // dispatched selectReport. Silently skip, selectReportAndLoad$ will retry.
          return EMPTY;
        }

        return this.reportsDataService
          .fetchReportData(report.dataEndpoint, report, {
            dateRange: report.requiresDateRange ? dateRange : undefined,
            fiscalPeriodId: report.requiresFiscalPeriod ? fiscalPeriodId : undefined,
            page: currentPage,
            limit: itemsPerPage,
          })
          .pipe(
            map((adapted) => ReportsActions.loadReportDataSuccess({
              data: adapted.data,
              meta: adapted.meta,
              isSummary: adapted.isSummary,
              summaryData: adapted.summaryData,
            })),
            catchError((error) => {
              const isForbidden = error.status === 403;
              return of(
                ReportsActions.loadReportDataFailure({
                  error: isForbidden
                    ? 'Sin permisos para ver este reporte'
                    : (error.error?.message || error.message || 'Error al cargar el reporte'),
                  isForbidden,
                }),
              );
            }),
          );
      }),
    ),
  );

  exportReport$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReportsActions.exportReport),
      withLatestFrom(
        this.store.select(selectSelectedReport),
        this.store.select(selectDateRange),
      ),
      mergeMap(([, report, dateRange]) => {
        // Export is a single, authoritative flow: the backend generates the XLSX
        // (full dataset, store-TZ dates, correct aggregation). The UI only offers
        // the button when the report declares an `exportEndpoint`, so a missing
        // endpoint here is a programming error, not a user-facing path.
        if (!report || !report.exportEndpoint) {
          return of(ReportsActions.exportReportFailure({ error: 'Este reporte no admite exportación' }));
        }

        return this.reportsDataService.exportFromBackend(report.exportEndpoint, dateRange).pipe(
          tap((blob) => {
            this.reportExportService.downloadBlob(blob, report.exportFilename);
            this.toastService.success('Reporte exportado correctamente');
          }),
          map(() => ReportsActions.exportReportSuccess()),
          catchError((error) =>
            of(
              ReportsActions.exportReportFailure({
                error: error.error?.message || error.message || 'Error al exportar el reporte',
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
        ofType(ReportsActions.loadReportDataFailure, ReportsActions.exportReportFailure),
        tap((action) => {
          if (!('isForbidden' in action && action.isForbidden)) {
            this.toastService.error(action.error);
          }
        }),
      ),
    { dispatch: false },
  );
}
