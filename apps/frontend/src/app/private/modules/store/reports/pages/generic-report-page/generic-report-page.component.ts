import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReportViewerComponent } from '../../components/report-viewer/report-viewer.component';
import { ReportsActions } from '../../state/reports.actions';
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
      (dateRangeChange)="onDateRangeChange($event)"
      (pageChange)="onPageChange($event)"
      (exportClick)="onExport()"
    />
  `,
})
export class GenericReportPageComponent {
  private store = inject(Store);
  private route = inject(ActivatedRoute);

  readonly report = toSignal(this.store.select(selectSelectedReport));
  readonly data = toSignal(this.store.select(selectReportData));
  readonly summaryData = toSignal(this.store.select(selectSummaryData));
  readonly loading = toSignal(this.store.select(selectLoading), { initialValue: false });
  readonly isForbidden = toSignal(this.store.select(selectIsForbidden), { initialValue: false });
  readonly currentPage = toSignal(this.store.select(selectCurrentPage), { initialValue: 1 });
  readonly totalPages = toSignal(this.store.select(selectTotalPages), { initialValue: 0 });
  readonly totalItems = toSignal(this.store.select(selectTotalItems), { initialValue: 0 });
  readonly itemsPerPage = toSignal(this.store.select(selectItemsPerPage), { initialValue: 10 });

  constructor() {
    const reportId = this.route.snapshot.data['reportId'];
    if (reportId) {
      this.store.dispatch(ReportsActions.selectReport({ reportId }));
    }
  }

  onDateRangeChange(dateRange: any): void {
    this.store.dispatch(ReportsActions.setDateRange({ dateRange }));
    this.store.dispatch(ReportsActions.loadReportData());
  }

  onPageChange(page: number): void {
    this.store.dispatch(ReportsActions.setPage({ page }));
  }

  onExport(): void {
    this.store.dispatch(ReportsActions.exportReport());
  }
}
