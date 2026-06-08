import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReportsActions } from '../../../state/reports.actions';
import { selectLoading, selectIsForbidden, selectReportData, selectSummaryData, selectSelectedReport, selectCurrentPage, selectTotalPages, selectTotalItems, selectItemsPerPage, selectDateRange } from '../../../state/reports.selectors';
import { ReportViewerComponent } from '../../../components/report-viewer/report-viewer.component';

@Component({
  selector: 'app-expense-summary-report',
  standalone: true,
  imports: [ReportViewerComponent],
  template: `
    <app-report-viewer
      [report]="report() ?? null"
      [data]="data() ?? null"
      [summaryData]="summaryData() ?? null"
      [loading]="loading()" [isForbidden]="isForbidden()"
      [currentPage]="currentPage()"
      [totalPages]="totalPages()"
      [totalItems]="totalItems()"
      [itemsPerPage]="itemsPerPage()"
       [dateRange]="dateRange() ?? null"
      (dateRangeChange)="onDateRangeChange($event)"
      (pageChange)="onPageChange($event)"
      (exportClick)="onExport()"
    />
  `,
})
export class ExpenseSummaryReportComponent {
  private readonly store = inject(Store);
  readonly report = toSignal(this.store.select(selectSelectedReport));
  readonly loading = toSignal(this.store.select(selectLoading), { initialValue: false });
  readonly isForbidden = toSignal(this.store.select(selectIsForbidden), { initialValue: false });
  readonly data = toSignal(this.store.select(selectReportData));
  readonly summaryData = toSignal(this.store.select(selectSummaryData));
  readonly currentPage = toSignal(this.store.select(selectCurrentPage), { initialValue: 1 });
  readonly totalPages = toSignal(this.store.select(selectTotalPages), { initialValue: 0 });
  readonly totalItems = toSignal(this.store.select(selectTotalItems), { initialValue: 0 });
  readonly itemsPerPage = toSignal(this.store.select(selectItemsPerPage), { initialValue: 10 });
  readonly dateRange = toSignal(this.store.select(selectDateRange));

  constructor() {
    this.store.dispatch(ReportsActions.selectReport({ reportId: 'expense-summary' }));
  }

  onDateRangeChange(dateRange: any): void {
    this.store.dispatch(ReportsActions.setDateRange({ dateRange }));
  }

  onPageChange(page: number): void {
    this.store.dispatch(ReportsActions.setPage({ page }));
  }
  onExport(): void {
    const data = this.data();
    if (!data || data.length === 0) return;

    const report = this.report();
    const cols = report?.columns || [];
    const headers = cols.map(c => c.header).join(',');
    const rows = data.map(row =>
      cols.map(c => {
        const val = row[c.key];
        return typeof val === 'string' && val.includes(',') ? `"${val}"` : val ?? '';
      }).join(',')
    );

    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report?.id || 'reporte'}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
