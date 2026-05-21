import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReportsActions } from '../../../state/reports.actions';
import { selectLoading, selectReportData, selectIsSummary, selectSummaryData, selectSelectedReport } from '../../../state/reports.selectors';
import { ReportViewerComponent } from '../../../components/report-viewer/report-viewer.component';

@Component({
  selector: 'app-product-performance-report',
  standalone: true,
  imports: [ReportViewerComponent],
  template: `
    <app-report-viewer
      [report]="report() ?? null"
      [data]="data() ?? null"
      [summaryData]="summaryData() ?? null"
      [loading]="loading()"
      (dateRangeChange)="onDateRangeChange($event)"
    />
  `,
})
export class ProductPerformanceReportComponent {
  private readonly store = inject(Store);
  readonly report = toSignal(this.store.select(selectSelectedReport));
  readonly loading = toSignal(this.store.select(selectLoading), { initialValue: false });
  readonly data = toSignal(this.store.select(selectReportData));
  readonly summaryData = toSignal(this.store.select(selectSummaryData));

  constructor() {
    this.store.dispatch(ReportsActions.selectReport({ reportId: 'product-performance' }));
  }

  onDateRangeChange(dateRange: any): void {
    this.store.dispatch(ReportsActions.setDateRange({ dateRange }));
    this.store.dispatch(ReportsActions.loadReportData());
  }
}
