import { Component, input, output, computed } from '@angular/core';
import { ReportColumn, ReportDefinition } from '../../interfaces/report.interface';
import { SummaryReportComponent } from '../summary-report/summary-report.component';
import { NestedReportComponent } from '../nested-report/nested-report.component';

import { ReportTableComponent } from '../report-table/report-table.component';
import { DateRangeFilterComponent } from '../../../analytics/components/date-range-filter/date-range-filter.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-report-viewer',
  standalone: true,
  imports: [
    SummaryReportComponent,
    NestedReportComponent,
    ReportTableComponent,
    DateRangeFilterComponent,
    IconComponent,
  ],
  template: `
    <div class="report-viewer">
      @if (report()?.requiresDateRange) {
        <div class="flex items-center gap-3 mb-5 px-4 py-2.5 bg-surface rounded-xl border border-border">
          <app-icon name="calendar" [size]="16" class="text-text-secondary flex-shrink-0" />
          <vendix-date-range-filter (dateRangeChange)="dateRangeChange.emit($event)" />
        </div>
      }

      @if (loading()) {
        <div class="flex items-center justify-center py-20">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      } @else if (hasData()) {
        @switch (report()?.type) {
          @case ('summary') {
            <app-summary-report
              [summaryData]="summaryData()!"
              [layout]="report()!.summaryLayout!"
            />
            @if (data() && data()!.length > 0) {
              <div class="mt-6">
                <vendix-report-table
                  [columns]="report()!.columns"
                  [data]="data()!"
                  [trackKey]="report()?.trackKey || 'id'"
                />
              </div>
            }
          }
          @case ('nested') {
            <app-nested-report
              [data]="data()!"
              [columns]="report()!.columns"
            />
          }
          @default {
            <vendix-report-table
              [columns]="report()?.columns || []"
              [data]="data()!"
              [trackKey]="report()?.trackKey || 'id'"
            />
          }
        }
      } @else {
        <div class="flex flex-col items-center justify-center py-20 text-gray-400">
          <p class="text-sm">Sin datos disponibles. Genera el reporte para ver los datos.</p>
        </div>
      }
    </div>
  `,
  styles: [],
})
export class ReportViewerComponent {
  readonly report = input<ReportDefinition | null>(null);
  readonly data = input<any[] | null>(null);
  readonly summaryData = input<Record<string, any> | null>(null);
  readonly loading = input<boolean>(false);

  readonly dateRangeChange = output<any>();

  readonly hasData = computed(() => {
    const d = this.data();
    const sd = this.summaryData();
    return (d && d.length > 0) || (sd && Object.keys(sd).length > 0);
  });
}
