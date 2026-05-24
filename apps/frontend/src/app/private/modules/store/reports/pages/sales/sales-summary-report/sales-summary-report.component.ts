import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReportsActions } from '../../../state/reports.actions';
import { selectLoading, selectIsForbidden, selectReportData, selectSummaryData, selectSelectedReport, selectCurrentPage, selectTotalPages, selectTotalItems, selectItemsPerPage } from '../../../state/reports.selectors';
import { ReportViewerComponent } from '../../../components/report-viewer/report-viewer.component';

@Component({
  selector: 'app-sales-summary-report',
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
      (dateRangeChange)="onDateRangeChange($event)"
      (pageChange)="onPageChange($event)"
    />
  `,
})
export class SalesSummaryReportComponent {
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

  constructor() {
    this.store.dispatch(ReportsActions.selectReport({ reportId: 'sales-summary' }));
  }

  onDateRangeChange(dateRange: any): void {
    this.store.dispatch(ReportsActions.setDateRange({ dateRange }));
    this.store.dispatch(ReportsActions.loadReportData());
  }

  onPageChange(page: number): void {
    this.store.dispatch(ReportsActions.setPage({ page }));
  }
}
