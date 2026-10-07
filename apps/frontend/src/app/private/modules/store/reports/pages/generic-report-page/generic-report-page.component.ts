import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReportViewerComponent } from '../../components/report-viewer/report-viewer.component';
import { ReportsActions } from '../../state/reports.actions';
import { ReportsDataService } from '../../services/reports-data.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { DateRangeSyncService } from '../../../shared/services/date-range-sync.service';
import { getDefaultDateRange } from '../../state/reports.state';
import { environment } from '../../../../../../../environments/environment';
import type { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import {
  VexiUiHost,
  VexiUiHostRegistry,
  vexiWhenReady,
} from '../../../../../../core/services/vexi-ui-host.registry';
import {
  selectSelectedReport,
  selectReportData,
  selectSummaryData,
  selectLoading,
  selectIsForbidden,
  selectCurrentPage,
  selectTotalPages,
  selectTotalItems,
  selectItemsPerPage,
  selectDateRange,
  selectDataFilters,
} from '../../state/reports.selectors';

@Component({
  selector: 'app-generic-report-page',
  standalone: true,
  imports: [ReportViewerComponent],
  template: `
    <app-report-viewer
      [report]="report() ?? null"
      [data]="data() ?? null"
      [summaryData]="summaryData() ?? null"
      [loading]="loading()"
      [isForbidden]="isForbidden()"
      [currentPage]="currentPage()"
      [totalPages]="totalPages()"
      [totalItems]="totalItems()"
      [itemsPerPage]="itemsPerPage()"
      [dateRange]="dateRange()"
      (dateRangeChange)="onDateRangeChange($event)"
      (pageChange)="onPageChange($event)"
      (exportClick)="onExport()"
      [enableRefresh]="true"
      (refreshClick)="onRefresh()"
      [categoryOptions]="categoryOptions()"
      [activeDataFilters]="activeDataFilters()"
      (dataFiltersChange)="onDataFiltersChange($event)"
    />
  `,
})
export class GenericReportPageComponent {
  private store = inject(Store);
  private route = inject(ActivatedRoute);
  private reportsDataService = inject(ReportsDataService);
  private toast = inject(ToastService);
  private dateRangeSync = inject(DateRangeSyncService);

  readonly report = toSignal(this.store.select(selectSelectedReport));
  readonly data = toSignal(this.store.select(selectReportData));
  readonly summaryData = toSignal(this.store.select(selectSummaryData));
  readonly loading = toSignal(this.store.select(selectLoading), { initialValue: false });
  readonly isForbidden = toSignal(this.store.select(selectIsForbidden), { initialValue: false });
  readonly currentPage = toSignal(this.store.select(selectCurrentPage), { initialValue: 1 });
  readonly totalPages = toSignal(this.store.select(selectTotalPages), { initialValue: 0 });
  readonly totalItems = toSignal(this.store.select(selectTotalItems), { initialValue: 0 });
  readonly itemsPerPage = toSignal(this.store.select(selectItemsPerPage), { initialValue: 10 });
  readonly dateRange = toSignal(this.store.select(selectDateRange), { initialValue: getDefaultDateRange() });

  private readonly vexiHosts = inject(VexiUiHostRegistry);
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);

  /** Opciones del filtro de categoría (solo se cargan si el reporte lo declara). */
  readonly categoryOptions = signal<SelectorOption[]>([]);
  /** Filtros vigentes en el store: el viewer los adopta al nacer o volver. */
  readonly activeDataFilters = toSignal(this.store.select(selectDataFilters), {
    initialValue: {} as Record<string, string | null>,
  });

  constructor() {
    this.vexiHosts.register(this.vexiHostAdapter);
    this.destroyRef.onDestroy(() =>
      this.vexiHosts.unregister(this.vexiHostAdapter),
    );

    const reportId = this.route.snapshot.data['reportId'];
    if (reportId) {
      this.store.dispatch(ReportsActions.selectReport({ reportId }));
    }

    effect(() => {
      const needsCategories = (this.report()?.dataFilters ?? []).some(
        (f) => f.optionsSource === 'categories',
      );
      if (needsCategories) {
        this.loadCategoryOptions();
      } else if (this.categoryOptions().length > 0) {
        this.categoryOptions.set([]);
      }
    });
  }

  private loadCategoryOptions(): void {
    this.http
      .get<{ data?: Array<{ id: number; name: string }> }>(
        `${environment.apiUrl}/store/categories`,
        { params: { limit: '200' } as any },
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.categoryOptions.set(
            (res?.data ?? []).map((c) => ({
              value: String(c.id),
              label: c.name,
            })),
          );
        },
        error: () => this.categoryOptions.set([]),
      });
  }

  // ── Host de Vexi (G8) ─────────────────────────────────────────────────
  //
  // Adapter over the page's own handlers (`onDateRangeChange`, `onPageChange`,
  // `onExport`, `onRefresh`). This is the screen `ui_export` dispatches
  // against: the `export` action here is the same button the person clicks.
  private readonly vexiHostAdapter: VexiUiHost = {
    vexiModuleKey: 'reports',
    readScreen: () => {
      const report = this.report();
      return {
        module_key: 'reports',
        title: report?.title ?? 'Reporte',
        visible_count: Array.isArray(this.data()) ? (this.data() as unknown[]).length : undefined,
        filters: {
          date_from: (this.dateRange() as { start_date?: string } | undefined)?.start_date,
          date_to: (this.dateRange() as { end_date?: string } | undefined)?.end_date,
        },
        page: this.currentPage(),
        limit: this.itemsPerPage(),
        total: this.totalItems(),
        total_pages: this.totalPages() || 1,
        notes: this.loading()
          ? 'El reporte todavía está cargando.'
          : this.isForbidden()
            ? 'Esta cuenta no tiene acceso a este reporte.'
            : `${report?.title ?? 'El reporte'} tiene ${this.totalItems()} fila(s) en total.`,
      };
    },
    listActions: () => [
      { id: 'export', label: 'Descargar este reporte en XLSX' },
    ],
    runAction: async (id) => {
      if (id === 'export') {
        const report = this.report();
        if (!report) {
          return {
            status: 'error' as const,
            message: 'No hay ningún reporte abierto para exportar.',
          };
        }
        this.onExport();
        return {
          status: 'ok' as const,
          message: `Disparé la descarga de "${report.title}".`,
          detail: { filename: `${report.id}.xlsx` },
        };
      }
      return {
        status: 'not_found' as const,
        message: `La pantalla de Reportes no tiene una acción "${id}".`,
      };
    },
    setFilter: async (values) => {
      const applied: string[] = [];
      const ignored: string[] = [];
      let note: string | undefined;

      if (values['date_from'] !== undefined || values['date_to'] !== undefined) {
        this.onDateRangeChange({
          start_date: String(values['date_from'] ?? ''),
          end_date: String(values['date_to'] ?? ''),
        });
        applied.push('rango de fechas');
      }

      if (values['page'] !== undefined) {
        const totalPages = this.totalPages() || 1;
        let page = Math.floor(Number(values['page']));
        if (!Number.isFinite(page)) {
          ignored.push('page');
        } else {
          if (page < 1) page = 1;
          if (page > totalPages) {
            note = `Pediste la página ${page} pero solo hay ${totalPages}; te dejé en la última.`;
            page = totalPages;
          }
          this.onPageChange(page);
          applied.push(`página ${page}`);
        }
      }

      for (const key of Object.keys(values)) {
        if (!['date_from', 'date_to', 'page'].includes(key)) {
          ignored.push(key);
        }
      }

      if (!applied.length) {
        return {
          status: 'not_found' as const,
          message:
            'El reporte filtra por rango de fechas (date_from/date_to) y pagina con page.',
        };
      }

      return {
        status: 'ok' as const,
        message:
          `Apliqué ${applied.join(', ')} en el reporte. Se está recargando; si necesitas el conteo, léelo de la pantalla después.` +
          (note ? ` ${note}` : '') +
          (ignored.length
            ? ` No apliqué ${ignored.join(', ')} porque este reporte no lo soporta.`
            : ''),
        detail: note ? { note } : undefined,
      };
    },
    refresh: () => {
      this.onRefresh();
      return { status: 'ok' as const, message: 'Recargué el reporte.' };
    },
    whenReady: () => vexiWhenReady(() => this.loading() ?? false),
  };

  onDateRangeChange(dateRange: any): void {
    this.dateRangeSync.setDateRange(dateRange);
    this.store.dispatch(ReportsActions.setDateRange({ dateRange }));
    this.store.dispatch(ReportsActions.loadReportData());
  }

  onDataFiltersChange(filters: Record<string, string | null>): void {
    this.store.dispatch(ReportsActions.setDataFilters({ filters }));
    this.store.dispatch(ReportsActions.loadReportData());
  }

  onPageChange(page: number): void {
    this.store.dispatch(ReportsActions.setPage({ page }));
  }

  onExport(): void {
    this.store.dispatch(ReportsActions.exportReport());
  }

  onRefresh(): void {
    const reportId = this.route.snapshot.data['reportId'];
    if (reportId) {
      this.reportsDataService.clearCache(reportId);
    } else {
      this.reportsDataService.clearCache();
    }
    this.store.dispatch(ReportsActions.loadReportData());
    this.toast.success('Datos del reporte actualizados');
  }
}
