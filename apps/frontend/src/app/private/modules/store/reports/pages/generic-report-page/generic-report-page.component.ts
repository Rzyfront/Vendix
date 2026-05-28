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
      (dateRangeChange)="onDateRangeChange($event)"
      (pageChange)="onPageChange($event)"
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
}
