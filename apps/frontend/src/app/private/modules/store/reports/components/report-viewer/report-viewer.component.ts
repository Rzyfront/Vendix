import { Component, input, output, computed } from '@angular/core';
import { ReportColumn, ReportDefinition, ReportStatField } from '../../interfaces/report.interface';
import { NestedReportComponent } from '../nested-report/nested-report.component';
import { DateRangeFilterComponent } from '../../../analytics/components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../../analytics/components/export-button/export-button.component';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import {
  ResponsiveDataViewComponent,
  IconComponent,
  StatsComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../shared/components';

interface StatCard {
  title: string;
  value: string | number;
  iconName: string;
  iconBgColor: string;
  iconColor: string;
}

const TYPE_ICONS: Record<string, { icon: string; bg: string; color: string }> = {
  currency: { icon: 'dollar-sign', bg: 'bg-green-100', color: 'text-green-600' },
  number: { icon: 'hash', bg: 'bg-blue-100', color: 'text-blue-600' },
  percentage: { icon: 'percent', bg: 'bg-amber-100', color: 'text-amber-600' },
  text: { icon: 'file-text', bg: 'bg-purple-100', color: 'text-purple-600' },
  date: { icon: 'calendar', bg: 'bg-indigo-100', color: 'text-indigo-600' },
};

function toTableColumns(columns: ReportColumn[]): TableColumn[] {
  return columns.map((col) => ({
    key: col.key,
    label: col.header,
    align: col.align,
  }));
}

function formatStatValue(value: any, type: string): string | number {
  if (value == null || value === undefined) return 0;
  const num = Number(value);
  if (isNaN(num)) return 0;
  if (type === 'currency') {
    return '$' + num.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  if (type === 'percentage') {
    return num.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }
  if (type === 'number') {
    return num.toLocaleString('es-CO');
  }
  return String(value);
}

@Component({
  selector: 'app-report-viewer',
  standalone: true,
  imports: [
    StatsComponent,
    NestedReportComponent,
    DateRangeFilterComponent,
    ExportButtonComponent,
    PaginationComponent,
    CardComponent,
    ResponsiveDataViewComponent,
    IconComponent,
  ],
  template: `
    <div class="flex flex-col gap-6">
      <!-- Stats Cards -->
      @if (statsCards().length > 0) {
        <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
          @for (stat of statsCards(); track stat.title) {
            <app-stats
              [title]="stat.title"
              [value]="stat.value"
              [iconName]="stat.iconName"
              [iconBgColor]="stat.iconBgColor"
              [iconColor]="stat.iconColor"
              [loading]="loading()"
            />
          }
        </div>
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
              @if (computedTotalItems() > 0) {
                &middot; {{ computedTotalItems() }} registros
              }
            </p>
          </div>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 w-full sm:w-auto">
            @if (report()?.requiresDateRange) {
              <vendix-date-range-filter [value]="dateRange()" (valueChange)="dateRangeChange.emit($event)" />
            }
            <vendix-export-button
              [loading]="exportLoading()"
              (export)="exportClick.emit()"
            />
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
          } @else if (report()?.type === 'nested') {
            <app-nested-report
              [data]="data()!"
              [columns]="report()!.columns"
            />
          } @else {
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
  readonly exportClick = output<void>();

  readonly exportLoading = input<boolean>(false);
  readonly dateRange = input<any>(undefined);

  readonly statsCards = computed<StatCard[]>(() => {
    const report = this.report();
    const data = this.data();
    const summaryData = this.summaryData();
    if (!report || !report.stats) return [];

    const source = summaryData || {};
    const hasSourceData = Object.keys(source).length > 0;

    return report.stats.map((s) => {
      const ic = TYPE_ICONS[s.type] || TYPE_ICONS['number'];
      let value: string | number = '-';

      if (hasSourceData && source[s.key] != null) {
        value = formatStatValue(source[s.key], s.type);
      } else if (data && data.length > 0) {
        const sum = data.reduce((acc, row) => {
          const v = Number(row[s.key]);
          return isNaN(v) ? acc : acc + v;
        }, 0);
        value = formatStatValue(sum, s.type);
      }

      return {
        title: s.label,
        value,
        iconName: s.icon || ic.icon,
        iconBgColor: ic.bg,
        iconColor: ic.color,
      };
    });
  });

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
    if (cols && cols.length > 0) return toTableColumns(cols);

    // Auto-generate columns from data keys when none defined
    const d = this.data();
    if (!d || d.length === 0) return [];
    const keys = Object.keys(d[0]).filter(k => !k.startsWith('_'));
    return keys.map(k => ({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }));
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
