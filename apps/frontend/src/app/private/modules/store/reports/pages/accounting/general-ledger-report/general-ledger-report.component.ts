import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReportsActions } from '../../../state/reports.actions';
import { selectLoading, selectIsForbidden, selectReportData, selectSummaryData, selectSelectedReport, selectCurrentPage, selectTotalPages, selectTotalItems, selectItemsPerPage, selectDateRange } from '../../../state/reports.selectors';
import { ReportViewerComponent } from '../../../components/report-viewer/report-viewer.component';

@Component({
  selector: 'app-general-ledger-report',
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
export class GeneralLedgerReportComponent {
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
    this.store.dispatch(ReportsActions.selectReport({ reportId: 'general-ledger' }));
  }

  onDateRangeChange(dateRange: any): void {
    this.store.dispatch(ReportsActions.setDateRange({ dateRange }));
  }

  onPageChange(page: number): void {
    this.store.dispatch(ReportsActions.setPage({ page }));
  }
  onExport(): void {
    this.store.dispatch(ReportsActions.exportReport());
  }
}
