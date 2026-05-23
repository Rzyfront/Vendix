import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReportsActions } from '../../../state/reports.actions';
import { selectLoading, selectReportData, selectSummaryData, selectSelectedReport, selectCurrentPage, selectTotalPages, selectTotalItems, selectItemsPerPage } from '../../../state/reports.selectors';
import { ReportViewerComponent } from '../../../components/report-viewer/report-viewer.component';

@Component({
  selector: 'app-customer-top-report',
  standalone: true,
  imports: [ReportViewerComponent],
  template: `
    <app-report-viewer
      [report]="report() ?? null"
      [data]="data() ?? null"
      [summaryData]="summaryData() ?? null"
      [loading]="loading()"
      [currentPage]="currentPage()"
      [totalPages]="totalPages()"
      [totalItems]="totalItems()"
      [itemsPerPage]="itemsPerPage()"
      (dateRangeChange)="onDateRangeChange($event)"
      (pageChange)="onPageChange($event)"
    />
  `,
})
export class CustomerTopReportComponent {
  private readonly store = inject(Store);
  readonly report = toSignal(this.store.select(selectSelectedReport));
  readonly loading = toSignal(this.store.select(selectLoading), { initialValue: false });
  readonly data = toSignal(this.store.select(selectReportData));
  readonly summaryData = toSignal(this.store.select(selectSummaryData));
  readonly currentPage = toSignal(this.store.select(selectCurrentPage), { initialValue: 1 });
  readonly totalPages = toSignal(this.store.select(selectTotalPages), { initialValue: 0 });
  readonly totalItems = toSignal(this.store.select(selectTotalItems), { initialValue: 0 });
  readonly itemsPerPage = toSignal(this.store.select(selectItemsPerPage), { initialValue: 10 });

  constructor() {
    this.store.dispatch(ReportsActions.selectReport({ reportId: 'customer-top' }));
  }

  onDateRangeChange(dateRange: any): void {
    this.store.dispatch(ReportsActions.setDateRange({ dateRange }));
    this.store.dispatch(ReportsActions.loadReportData());
  }

  onPageChange(page: number): void {
    this.store.dispatch(ReportsActions.setPage({ page }));
  }
}
