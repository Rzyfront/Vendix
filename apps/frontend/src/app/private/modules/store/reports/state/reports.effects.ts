import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, mergeMap, catchError, withLatestFrom, tap } from 'rxjs/operators';
import { ReportsActions } from './reports.actions';
import { selectSelectedReport, selectDateRange, selectFiscalPeriodId, selectReportData } from './reports.selectors';
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

  loadReportData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReportsActions.loadReportData),
      withLatestFrom(
        this.store.select(selectSelectedReport),
        this.store.select(selectDateRange),
        this.store.select(selectFiscalPeriodId),
      ),
      mergeMap(([, report, dateRange, fiscalPeriodId]) => {
        if (!report) {
          return of(ReportsActions.loadReportDataFailure({ error: 'No hay reporte seleccionado' }));
        }

        return this.reportsDataService
          .fetchReportData(report.dataEndpoint, {
            dateRange: report.requiresDateRange ? dateRange : undefined,
            fiscalPeriodId: report.requiresFiscalPeriod ? fiscalPeriodId : undefined,
          })
          .pipe(
            map(({ data, meta }) => ReportsActions.loadReportDataSuccess({ data, meta })),
            catchError((error) =>
              of(
                ReportsActions.loadReportDataFailure({
                  error: error.error?.message || error.message || 'Error al cargar el reporte',
                }),
              ),
            ),
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
        this.store.select(selectReportData),
      ),
      mergeMap(([, report, dateRange, data]) => {
        if (!report) {
          return of(ReportsActions.exportReportFailure({ error: 'No hay reporte seleccionado' }));
        }

        // If backend has export endpoint, use it
        if (report.exportEndpoint) {
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
        }

        // Otherwise, generate XLSX locally from current data
        if (data && data.length > 0) {
          try {
            this.reportExportService.exportToXlsx(data, report.columns, report.exportFilename);
            this.toastService.success('Reporte exportado correctamente');
            return of(ReportsActions.exportReportSuccess());
          } catch (error: any) {
            return of(
              ReportsActions.exportReportFailure({
                error: error.message || 'Error al generar el archivo',
              }),
            );
          }
        }

        return of(
          ReportsActions.exportReportFailure({
            error: 'No hay datos para exportar. Genera el reporte primero.',
          }),
        );
      }),
    ),
  );

  showError$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ReportsActions.loadReportDataFailure, ReportsActions.exportReportFailure),
        tap(({ error }) => this.toastService.error(error)),
      ),
    { dispatch: false },
  );
}
