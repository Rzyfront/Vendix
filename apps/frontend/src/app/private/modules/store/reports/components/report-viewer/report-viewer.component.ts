import { Component, input, output, computed } from '@angular/core';
import { ReportColumn, ReportDefinition } from '../../interfaces/report.interface';
import { SummaryReportComponent } from '../summary-report/summary-report.component';
import { NestedReportComponent } from '../nested-report/nested-report.component';
import { DateRangeFilterComponent } from '../../../analytics/components/date-range-filter/date-range-filter.component';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import {
  ResponsiveDataViewComponent,
  IconComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../shared/components';

function toTableColumns(columns: ReportColumn[]): TableColumn[] {
  return columns.map((col) => ({
    key: col.key,
    label: col.header,
    align: col.align,
  }));
}

@Component({
  selector: 'app-report-viewer',
  standalone: true,
  imports: [
    SummaryReportComponent,
    NestedReportComponent,
    DateRangeFilterComponent,
    PaginationComponent,
    CardComponent,
    ResponsiveDataViewComponent,
    IconComponent,
  ],
  template: `
    <div class="flex flex-col gap-6">
      @if (report()?.type === 'summary' && summaryData()) {
        <app-summary-report
          [summaryData]="summaryData()!"
          [layout]="report()!.summaryLayout!"
        />
      }

      <app-card [padding]="false" overflow="hidden">
        <!-- Header -->
        <div class="p-2 md:px-6 md:py-4 border-b border-border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-text-primary">
              {{ report()?.title || 'Reporte' }}
            </h2>
            <p class="hidden sm:block text-xs text-text-secondary mt-0.5">
              {{ report()?.description || '' }}
              @if (totalItems() > 0) {
                &middot; {{ totalItems() }} registros
              }
            </p>
          </div>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            @if (report()?.requiresDateRange) {
              <vendix-date-range-filter (valueChange)="dateRangeChange.emit($event)" />
            }
          </div>
        </div>

        <!-- Table -->
        <div class="relative min-h-[400px] p-2 md:p-4">
          @if (loading()) {
            <div class="absolute inset-0 bg-surface/50 z-10 flex items-center justify-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          }

          @if (isForbidden()) {
            <div class="flex flex-col items-center justify-center py-20 text-text-secondary">
              <app-icon name="shield-off" [size]="48" />
              <p class="mt-4 text-sm font-medium">No tienes permisos para ver este reporte</p>
              <p class="mt-1 text-xs text-text-tertiary">Contacta al administrador para obtener acceso</p>
            </div>
          } @switch (report()?.type) {
            @case ('nested') {
              <app-nested-report
                [data]="data()!"
                [columns]="report()!.columns"
              />
            }
            @default {
              <app-responsive-data-view
                [data]="paginatedData()"
                [columns]="tableColumns()"
                [cardConfig]="cardConfig()"
                [loading]="loading()"
                [striped]="true"
                tableSize="sm"
                emptyMessage="Sin datos disponibles para este reporte"
                emptyIcon="file-bar-chart"
              />
            }
          }

          @if (!loading() && computedTotalItems() > 0) {
            <div class="mt-4 border-t border-border pt-4 flex justify-center">
              <app-pagination
                [currentPage]="currentPage()"
                [totalPages]="computedTotalPages()"
                [total]="computedTotalItems()"
                [limit]="itemsPerPage()"
                infoStyle="range"
                (pageChange)="pageChange.emit($event)"
              />
            </div>
          }
        </div>
      </app-card>
    </div>
  `,
  styles: [],
})
export class ReportViewerComponent {
  readonly report = input<ReportDefinition | null>(null);
  readonly data = input<any[] | null>(null);
  readonly summaryData = input<Record<string, any> | null>(null);
  readonly loading = input<boolean>(false);
  readonly isForbidden = input<boolean>(false);
  readonly currentPage = input<number>(1);
  readonly totalPages = input<number>(0);
  readonly totalItems = input<number>(0);
  readonly itemsPerPage = input<number>(10);

  readonly dateRangeChange = output<any>();
  readonly pageChange = output<number>();

  readonly paginatedData = computed(() => {
    const d = this.data();
    if (!d || d.length === 0) return [];
    const start = (this.currentPage() - 1) * this.itemsPerPage();
    return d.slice(start, start + this.itemsPerPage());
  });

  readonly computedTotalItems = computed(() => {
    const d = this.data();
    return this.totalItems() || (d ? d.length : 0);
  });

  readonly computedTotalPages = computed(() => {
    const total = this.computedTotalItems();
    return total > 0 ? Math.max(1, Math.ceil(total / this.itemsPerPage())) : 1;
  });

  readonly tableColumns = computed<TableColumn[]>(() => {
    const cols = this.report()?.columns;
    return cols ? toTableColumns(cols) : [];
  });

  readonly cardConfig = computed<ItemListCardConfig>(() => {
    const cols = this.report()?.columns || [];
    const titleCol = cols.find((c) => c.type === 'text');
    const subtitleCol = cols.find((c) => c.type === 'text' && c !== titleCol);
    const badgeCol = cols.find((c) => c.key === 'status' || c.key === 'state');
    const footerCol = cols.find((c) => c.type === 'currency');
    return {
      titleKey: titleCol?.key || cols[0]?.key || 'id',
      subtitleKey: subtitleCol?.key,
      badgeKey: badgeCol?.key,
      footerKey: footerCol?.key,
      footerLabel: footerCol?.header || '',
      footerStyle: footerCol ? 'prominent' : undefined,
      detailKeys: cols
        .filter((c) => c.type === 'number' || c.type === 'percentage')
        .slice(0, 2)
        .map((c) => ({ key: c.key, label: c.header })),
    };
  });
}
